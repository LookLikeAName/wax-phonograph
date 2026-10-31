// 桌面版（Electron）端對端測試：存檔、從命令列開檔、單一執行個體、系統匣指令、關閉視窗縮到系統匣。
// 用法（先 npm run build）：node tests/electron_check.mjs [測試音檔，預設 ~/phono-test/tone.wav]；沒有顯示器的 Linux 用 xvfb-run -a 執行
import { _electron as electron } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const audio = process.argv[2] || path.join(os.homedir(), 'phono-test', 'tone.wav');
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) { console.error('找不到 dist/index.html，請先執行 npm run build'); process.exit(1); }
if (!fs.existsSync(audio)) { console.error(`找不到測試音檔 ${audio}，請先執行 python3 tests/make_test_audio.py`); process.exit(1); }
const electronBin = path.join(root, 'node_modules', '.bin', 'electron');
const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phono-save-'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'phono-user-'));   // 每次用乾淨的設定，不影響本機
// 無頭環境沒有 GPU：用 SwiftShader 軟體 WebGL（不能用 --disable-gpu，那會讓 WebGL 建不起來、整個程式停在開場畫面）
const FLAGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${userData}`];
const env = { ...process.env, PHONO_TEST_SAVE_DIR: saveDir };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`); if (!ok) failed = true; };

async function launch(extraArgs = []) {
  const app = await electron.launch({ executablePath: electronBin, args: [root, ...FLAGS, ...extraArgs], env, cwd: root });
  const page = await app.firstWindow();
  await page.waitForSelector('#bStart');
  // 第一次啟動時關掉 3D 場景效果（swiftshader 很慢）並重新載入；之後的啟動沿用同一個設定資料夾，不再重新載入，
  // 否則啟動時從命令列收到的檔案會在重新載入時遺失
  if (!(await page.evaluate(() => localStorage.getItem('phonograph.perf')))) {
    await page.evaluate(() => localStorage.setItem('phonograph.perf', JSON.stringify({ quality: 'off' })));
    await page.reload(); await page.waitForSelector('#bStart');
  }
  return { app, page };
}
const start = async page => {
  await page.evaluate(() => document.getElementById('bStart').click());
  try { await page.waitForSelector('#splash', { state: 'detached', timeout: 60000 }); }
  catch (e) { throw new Error('開啟留聲機失敗：' + await page.evaluate(() => document.getElementById('splashMsg')?.textContent || '（沒有錯誤訊息）')); }
};
const rackCount = page => page.evaluate(() => document.querySelectorAll('#rackList .rk[data-id]').length);

try {
  // 1. 存檔：選項視窗按確認後，經由主程序寫檔（測試模式不跳對話框）
  let { app, page } = await launch();
  check('桌面版橋接存在', await page.evaluate(() => typeof window.phonoDesktop?.saveFile === 'function'));
  check('畫面中碰不到 Node', await page.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined'));
  check('桌面版隱藏下載連結', await page.evaluate(() => document.body.classList.contains('desktop') && [...document.querySelectorAll('.webOnly')].every(e => getComputedStyle(e).display === 'none')));
  await page.evaluate(() => window.open('about:blank')); await sleep(500);   // 外部連結交給系統瀏覽器，程式裡不會多開視窗
  check('連結不會在程式裡開新視窗', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length) === 1);
  await start(page);
  await page.setInputFiles('#fileIn', audio); await sleep(2000);
  await page.evaluate(() => document.getElementById('fBurn').click());
  for (let i = 0; i < 60 && await page.evaluate(() => document.getElementById('fBurn').disabled); i++) await sleep(500);
  await sleep(1000);
  const burned = await page.evaluate(() => document.getElementById('toast').textContent);
  check('快速刻錄成功', burned.includes('刻成'), burned);
  await page.evaluate(() => { document.querySelector('.dtabs [data-dt=rack]').click(); document.getElementById('rackSelAll').click(); });
  await page.evaluate(() => { document.getElementById('bSaveSel').click(); document.getElementById('xOk').click(); });
  let saved = null;
  for (let i = 0; i < 40 && !saved; i++) { await sleep(250); saved = fs.readdirSync(saveDir).find(f => f.endsWith('.waxrack')); }
  check('存檔寫進磁碟', !!saved, saved || '');
  const savedPath = saved && path.join(saveDir, saved);
  if (savedPath) { const b = fs.readFileSync(savedPath), hl = b.readUInt32LE(0); check('檔案是 .waxrack 格式', JSON.parse(b.subarray(4, 4 + hl)).magic === 'WAXRACK'); }

  // 2. 系統匣指令：播放／停止
  const send = c => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('command', c), c);
  await send('toggle-play'); await sleep(1500);
  check('系統匣「播放／停止」開始播放', await page.evaluate(() => document.getElementById('bPlay').classList.contains('on')));
  // 3. 關閉視窗：縮到系統匣，程式與播放都繼續
  const hasTray = fs.existsSync(path.join(root, 'build', 'tray.png'));
  if (hasTray) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await sleep(1000);
    const st = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { n: BrowserWindow.getAllWindows().length, visible: w?.isVisible() }; });
    check('關閉視窗後縮到系統匣', st.n === 1 && st.visible === false, JSON.stringify(st));
    check('縮到系統匣後仍在播放', await page.evaluate(() => document.getElementById('bPlay').classList.contains('on')));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  } else console.log('skip 縮到系統匣（沒有 build/tray.png）');
  await send('stop'); await sleep(800);
  check('系統匣「停止」', !(await page.evaluate(() => document.getElementById('bPlay').classList.contains('on'))));
  await app.evaluate(({ app }) => { app.quit(); }).catch(() => {}); await app.close().catch(() => {});

  if (savedPath) {
    // 4. 從命令列開檔（等同雙擊 .waxrack）：留聲機開啟前先排隊，開啟後載入
    ({ app, page } = await launch([savedPath]));
    await sleep(1500);
    check('開啟前收到檔案會排隊', (await page.evaluate(() => document.getElementById('toast').textContent)).includes('開啟留聲機後載入'));
    await start(page); await sleep(2500);
    await page.evaluate(() => document.querySelector('.dtabs [data-dt=rack]').click());
    const n1 = await rackCount(page);
    check('雙擊開啟的蠟筒架已載入', n1 >= 1, `${n1} 支`);

    // 5. 單一執行個體：再開一次程式並帶檔案，應該交給已開的視窗，第二個程序自己結束
    const second = spawn(electronBin, [root, ...FLAGS, savedPath], { env, stdio: 'ignore' });
    const exited = await new Promise(r => { const t = setTimeout(() => r(false), 15000); second.on('exit', () => { clearTimeout(t); r(true); }); });
    check('第二個程序自行結束', exited);
    await sleep(2500);
    const n2 = await rackCount(page);
    check('第二次開啟的檔案加進同一個視窗', n2 > n1, `${n1} → ${n2} 支`);
    await app.evaluate(({ app }) => { app.quit(); }).catch(() => {}); await app.close().catch(() => {});
  }
} catch (e) { console.error(e); failed = true; }
finally { fs.rmSync(saveDir, { recursive: true, force: true }); fs.rmSync(userData, { recursive: true, force: true }); }
console.log(failed ? 'FAIL' : 'PASS'); process.exit(failed ? 1 : 0);
