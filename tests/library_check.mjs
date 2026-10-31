// 桌面版曲庫測試：新增工作區（資料夾）→ 儲存 → 批次轉檔到輸出資料夾 → 設定改變時的狀態 → 播放佇列跨歌接續 → 重新開啟程式後還原工作區。
// 用法（先 npm run build）：node tests/library_check.mjs；沒有顯示器的 Linux 用 xvfb-run -a 執行
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) { console.error('找不到 dist/index.html，請先執行 npm run build'); process.exit(1); }
const electronBin = path.join(root, 'node_modules', '.bin', 'electron');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phono-lib-'));
const music = path.join(tmp, 'Music'), outDir = path.join(tmp, 'Wax'), wsFile = path.join(tmp, '測試.waxspace'), userData = path.join(tmp, 'user');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`); if (!ok) failed = true; };

// 測試音檔：兩首 3 秒的正弦波，一首在子資料夾
function wav(file, freq, secs = 3, sr = 22050) {
  const n = sr * secs, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(9000 * Math.sin(2 * Math.PI * freq * i / sr)), 44 + i * 2);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, b);
}
wav(path.join(music, '01 第一首.wav'), 330);
wav(path.join(music, 'Disc 2', '02 第二首.wav'), 440);

const FLAGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${userData}`];
async function launch(pick) {
  const env = { ...process.env, PHONO_TEST_PICK: JSON.stringify(pick) };
  const app = await electron.launch({ executablePath: electronBin, args: [root, ...FLAGS], env, cwd: root });
  const page = await app.firstWindow(); await page.waitForSelector('#bStart');
  if (!(await page.evaluate(() => localStorage.getItem('phonograph.perf')))) {
    await page.evaluate(() => localStorage.setItem('phonograph.perf', JSON.stringify({ quality: 'off' }))); await page.reload(); await page.waitForSelector('#bStart');
  }
  await page.evaluate(() => document.getElementById('bStart').click()); await page.waitForSelector('#splash', { state: 'detached', timeout: 60000 });
  return { app, page };
}
const rows = page => page.evaluate(() => [...document.querySelectorAll('#pvRows tr[data-k]')].map(r => r.children[1].textContent.trim() + '|' + r.children[2].textContent.trim()));
const waitRows = async (page, pred, ms = 60000) => { const t = Date.now(); let r; while (Date.now() - t < ms) { r = await rows(page); if (pred(r)) return r; await sleep(400); } return r; };
const click = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
// 等到條件成立（機器忙的時候比較慢，不用固定的等待時間）
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch {} await sleep(300); } return false; };

try {
  // 1. 新增工作區（選音樂資料夾）、儲存
  let { app, page } = await launch({ folders: [music, outDir], saveWorkspace: wsFile });
  await click(page, '#bPlayer'); await click(page, '.pv-tabs [data-pv=lib]');
  await click(page, '#pvLibDesk [data-a=new]');
  let r = await waitRows(page, x => x.length === 2);
  check('掃描到資料夾裡的兩首（含子資料夾）', r.length === 2, JSON.stringify(r));
  check('一開始都是未轉檔', r.every(x => x.startsWith('未轉檔')));
  await click(page, '#pvLibDesk [data-a=save]');
  check('工作區已存檔', await until(() => fs.existsSync(wsFile)));

  // 2. 全部轉檔（第一次會要求選輸出資料夾）
  await click(page, '#pvLibDesk [data-a=convAll]');
  r = await waitRows(page, x => x.length === 2 && x.every(y => y.startsWith('已轉檔')), 120000);
  check('批次轉檔完成', r.every(x => x.startsWith('已轉檔')), JSON.stringify(r));
  const outs = []; const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : outs.push(path.relative(outDir, path.join(d, f.name)).split(path.sep).join('/')); };
  if (fs.existsSync(outDir)) walk(outDir);
  check('輸出依來源資料夾分類', outs.sort().join(',') === 'Music/01 第一首.waxrack,Music/Disc 2/02 第二首.waxrack', outs.join(','));
  check('工作區記下轉檔結果', await until(() => Object.values(JSON.parse(fs.readFileSync(wsFile, 'utf8')).songs).filter(s => s.out).length === 2));

  // 3. 改蠟材 → 設定已變更；改回來 → 已轉檔
  await page.evaluate(() => { const s = document.querySelector('#pvLibDesk [data-k=wax]'); s.value = 'amber'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  r = await waitRows(page, x => x.every(y => y.startsWith('設定已變更')), 10000);
  check('改轉檔設定後標示「設定已變更」', r.every(x => x.startsWith('設定已變更')), JSON.stringify(r));
  await page.evaluate(() => { const s = document.querySelector('#pvLibDesk [data-k=wax]'); s.value = 'brown'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  r = await waitRows(page, x => x.every(y => y.startsWith('已轉檔')), 10000);
  check('改回來又是「已轉檔」', r.every(x => x.startsWith('已轉檔')));

  // 4. 全選 → 播放：第一首播完自動接第二首；蠟筒架上最多只放兩首
  await page.evaluate(() => { const a = document.getElementById('pvSelAll'); a.click(); });
  await click(page, '#pvLibDesk [data-a=playSel]');
  const started = await until(() => page.evaluate(() => document.getElementById('pvTitle').textContent === '01 第一首' && document.getElementById('pvPlay').textContent === '■'));
  const t1 = await page.evaluate(() => document.getElementById('pvTitle').textContent);
  check('開始播放第一首', started, t1);
  let t2 = t1; for (let i = 0; i < 40 && t2 === t1; i++) { await sleep(500); t2 = await page.evaluate(() => document.getElementById('pvTitle').textContent); }
  check('自動接到第二首', t2 === '02 第二首', t2);
  await sleep(1500);
  const groups = await page.evaluate(() => document.querySelectorAll('#rackList .grp').length);
  check('蠟筒架上只留目前與下一首（≤ 3 組，含原本的空白蠟筒）', groups <= 3, `${groups} 組`);
  // 手動上一首／下一首來回切換：舊的歌要拿掉，不能越積越多
  const title = () => page.evaluate(() => document.getElementById('pvTitle').textContent);
  for (const [btn, want] of [['#pvPrev', '01 第一首'], ['#pvNext', '02 第二首'], ['#pvPrev', '01 第一首']]) {
    await click(page, btn);
    if (!(await until(async () => (await title()) === want && (await page.evaluate(() => document.getElementById('pvPlay').textContent)) === '■'))) { check(`切換到 ${want}`, false, await title()); break; }
  }
  await sleep(1500);
  const after = await page.evaluate(() => [...document.querySelectorAll('#rackList .grp')].length);
  check('來回切歌後蠟筒架仍 ≤ 3 組', after <= 3, `${after} 組`);
  await page.keyboard.press('p'); await sleep(300);
  check('按 P 回到留聲機', !(await page.evaluate(() => document.body.classList.contains('player'))));
  await app.evaluate(({ app }) => app.quit()).catch(() => {}); await app.close().catch(() => {});

  // 5. 重新開啟：自動載入上次的工作區，狀態仍是已轉檔
  ({ app, page } = await launch({}));
  await click(page, '#bPlayer'); await click(page, '.pv-tabs [data-pv=lib]');
  r = await waitRows(page, x => x.length === 2 && x.every(y => y.startsWith('已轉檔')), 20000);
  check('重新開啟後還原工作區與轉檔狀態', r.length === 2 && r.every(x => x.startsWith('已轉檔')), JSON.stringify(r));
  await app.evaluate(({ app }) => app.quit()).catch(() => {}); await app.close().catch(() => {});
} catch (e) { console.error(e); failed = true; }
finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(failed ? 'FAIL' : 'PASS'); process.exit(failed ? 1 : 0);
