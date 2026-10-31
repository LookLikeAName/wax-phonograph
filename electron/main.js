// Electron 主程序：視窗、存檔對話框、開啟 .waxrack／音檔、系統匣、單一執行個體
// 畫面就是建置好的單一檔案 dist/index.html；網頁版與桌面版共用同一份程式，差異只在 src/platform/。
import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFile } from 'music-metadata';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV_URL = process.env.PHONO_DEV_URL;               // 開發時指向 Vite dev server（npm run electron:dev）
const TEST_SAVE_DIR = process.env.PHONO_TEST_SAVE_DIR;   // 自動測試：不跳存檔對話框，直接存進這個資料夾
const RACK_EXT = ['.waxrack', '.waxcyl'];
const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.opus', '.webm'];

let win = null, tray = null, quitting = false, rendererReady = false, hintShown = false;
const pending = [];   // 視窗還沒準備好時收到的檔案

// ---- 視窗大小與上次存檔位置，記在 userData/state.json ----
const stateFile = () => path.join(app.getPath('userData'), 'state.json');
let state = {};
try { state = JSON.parse(readFileSync(stateFile(), 'utf8')); } catch {}
const saveState = () => { try { writeFileSync(stateFile(), JSON.stringify(state)); } catch {} };

// ---- 從命令列（雙擊檔案、第二次啟動）找出要開的檔案 ----
const wanted = f => [...RACK_EXT, ...AUDIO_EXT].includes(path.extname(f).toLowerCase());
const filesFromArgv = argv => argv.slice(1).filter(a => !a.startsWith('-') && wanted(a) && existsSync(a));
async function openFiles(paths) {
  for (const p of paths) {
    try { pending.push({ name: path.basename(p), data: new Uint8Array(await fs.readFile(p)) }); }
    catch (e) { console.error('無法讀取', p, e.message); }
  }
  flush();
}
function flush() { if (!win || !rendererReady) return; while (pending.length) win.webContents.send('open-file', pending.shift()); }

function showWindow() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

function createWindow() {
  const b = state.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1440, height: b.height || 900, x: b.x, y: b.y, minWidth: 960, minHeight: 600,
    backgroundColor: '#140f0b', autoHideMenuBar: true, show: false,
    icon: path.join(root, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(root, 'electron', 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false,   // 縮到系統匣時繼續播放
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  if (DEV_URL) win.loadURL(DEV_URL); else win.loadFile(path.join(root, 'dist', 'index.html'));
  win.webContents.on('did-start-loading', () => { rendererReady = false; });
  // 頁面裡的外部連結（下載頁、GitHub）交給系統瀏覽器開，不在程式裡開新視窗；視窗本身也不允許被導到別的網址
  const external = url => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (url !== win.webContents.getURL()) { e.preventDefault(); external(url); } });
  win.on('close', e => {
    state.bounds = win.getNormalBounds(); state.maximized = win.isMaximized(); saveState();
    if (!quitting && tray) {   // 關閉視窗只是縮到系統匣，音樂繼續播
      e.preventDefault(); win.hide();
      if (!hintShown && process.platform === 'win32') {
        hintShown = true; tray.displayBalloon({ title: '蠟筒留聲機仍在執行', content: '從系統匣圖示可以再打開視窗或結束程式。' });
      }
    }
  });
  win.on('closed', () => { win = null; });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(root, 'build', 'tray.png'));
  if (icon.isEmpty()) return;   // 沒有圖示就不建系統匣（關閉視窗會直接結束）
  tray = new Tray(icon);
  tray.setToolTip('蠟筒留聲機');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '顯示視窗', click: showWindow },
    { label: '播放／停止', click: () => win?.webContents.send('command', 'toggle-play') },
    { label: '停止', click: () => win?.webContents.send('command', 'stop') },
    { type: 'separator' },
    { label: '結束', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

// ---- 渲染端呼叫 ----
ipcMain.on('renderer-ready', () => { rendererReady = true; flush(); });
ipcMain.handle('save-file', async (_e, { data, name }) => {
  let target;
  if (TEST_SAVE_DIR) target = path.join(TEST_SAVE_DIR, name);
  else {
    const ext = path.extname(name).slice(1).toLowerCase();
    const filters = ext === 'wav' ? [{ name: 'WAV 音檔', extensions: ['wav'] }] : ext === 'waxrack' ? [{ name: '蠟筒架', extensions: ['waxrack'] }] : [];
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(state.saveDir || app.getPath('music'), name), filters });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  await fs.writeFile(target, Buffer.from(data));
  state.saveDir = path.dirname(target); saveState();
  return target;
});

// ---- 檔案系統（工作區／批次轉換／音樂播放器）：全部走固定通道，路徑與副檔名在這裡檢查 ----
const WS_EXT = ['.waxrack', '.waxspace'];
const READ_EXT = [...AUDIO_EXT, ...WS_EXT];
const MAX_READ = 2 * 1024 ** 3, MAX_COVER = 1.5 * 1024 * 1024;
const extOf = p => path.extname(p).toLowerCase();
const str = (v, what) => { if (typeof v !== 'string' || !v || v.includes('\0')) throw new Error(`參數錯誤：${what}`); return v; };
const absPath = (v, what) => path.resolve(str(v, what));
const audioFilter = { name: '音檔', extensions: AUDIO_EXT.map(e => e.slice(1)) };
const wsFilter = { name: '工作區', extensions: ['waxspace'] };
const pickOpen = async (properties, filters) => {
  const r = await dialog.showOpenDialog(win, { properties, filters });
  return r.canceled || !r.filePaths.length ? null : r.filePaths;
};
// 遞迴掃描：只收音檔，略過隱藏項目與符號連結資料夾，讀不到的子資料夾直接跳過
async function walk(dir, root, out) {
  let ents;
  try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const d of ents) {
    if (d.name.startsWith('.')) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) await walk(p, root, out);
    else if ((d.isFile() || d.isSymbolicLink()) && AUDIO_EXT.includes(extOf(d.name))) {
      try {
        const st = await fs.stat(p);
        if (st.isFile()) out.push({ path: p, root, rel: path.relative(root, p).split(path.sep).join('/'), name: d.name, size: st.size, mtime: st.mtimeMs });
      } catch {}
    }
  }
}
const natCmp = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const safeSeg = s => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/[. ]+$/, '');

// 自動測試：PHONO_TEST_PICK＝{"folders":[…],"files":[…],"openWorkspace":"…","saveWorkspace":"…"}，各對話框依序回傳這些值、不跳視窗
const TEST_PICK = (() => { try { return JSON.parse(process.env.PHONO_TEST_PICK || 'null'); } catch { return null; } })();
ipcMain.handle('fs:pickFolder', async () => TEST_PICK ? (TEST_PICK.folders?.shift() ?? null) : (await pickOpen(['openDirectory', 'createDirectory']))?.[0] ?? null);
ipcMain.handle('fs:pickAudioFiles', async () => TEST_PICK ? (TEST_PICK.files || []) : (await pickOpen(['openFile', 'multiSelections'], [audioFilter])) ?? []);
ipcMain.handle('fs:pickOpenWorkspace', async () => TEST_PICK ? (TEST_PICK.openWorkspace ?? null) : (await pickOpen(['openFile'], [wsFilter]))?.[0] ?? null);
ipcMain.handle('fs:pickSaveWorkspace', async (_e, defaultName) => {
  if (TEST_PICK) return TEST_PICK.saveWorkspace ?? null;
  const name = path.basename(typeof defaultName === 'string' && defaultName ? defaultName : '工作區.waxspace');
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(state.saveDir || app.getPath('documents'), name), filters: [wsFilter] });
  if (r.canceled || !r.filePath) return null;
  state.saveDir = path.dirname(r.filePath); saveState();
  return r.filePath;
});
ipcMain.handle('fs:scan', async (_e, sources) => {
  if (!Array.isArray(sources)) throw new Error('參數錯誤：sources');
  const map = new Map();
  for (const s of sources) {
    if (!s || (s.type !== 'folder' && s.type !== 'file')) throw new Error('參數錯誤：source.type');
    const p = absPath(s.path, 'source.path'), items = [];
    if (s.type === 'folder') await walk(p, p, items);
    else {
      try {
        const st = await fs.stat(p);
        if (st.isFile()) items.push({ path: p, root: null, rel: path.basename(p), name: path.basename(p), size: st.size, mtime: st.mtimeMs });
      } catch {}
    }
    for (const it of items) if (!map.has(it.path)) map.set(it.path, it);
  }
  return [...map.values()].sort((a, b) => natCmp(a.root || '', b.root || '') || natCmp(a.rel, b.rel));
});
ipcMain.handle('fs:stat', async (_e, p) => {
  try { const st = await fs.stat(absPath(p, 'path')); return { size: st.size, mtime: st.mtimeMs }; } catch { return null; }
});
ipcMain.handle('fs:readFile', async (_e, p) => {
  p = absPath(p, 'path');
  if (!READ_EXT.includes(extOf(p))) throw new Error('不允許讀取此類型的檔案');
  if ((await fs.stat(p)).size > MAX_READ) throw new Error('檔案超過 2 GB');
  return new Uint8Array(await fs.readFile(p));
});
ipcMain.handle('fs:writeFile', async (_e, p, data) => {
  p = absPath(p, 'path');
  if (!WS_EXT.includes(extOf(p))) throw new Error('只允許寫入 .waxrack 與 .waxspace');
  if (!(data instanceof Uint8Array)) throw new Error('參數錯誤：data');
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';   // 先寫暫存檔再改名，中途失敗不會留下半個檔案
  try { await fs.writeFile(tmp, data); await fs.rename(tmp, p); }
  catch (e) { await fs.rm(tmp, { force: true }).catch(() => {}); throw e; }
});
ipcMain.handle('fs:outputPath', (_e, outDir, relNoExt) => {
  const base = absPath(outDir, 'outDir');
  const segs = str(relNoExt, 'relNoExt').split('/').map(safeSeg).filter(s => s && s !== '.' && s !== '..');
  if (!segs.length) throw new Error('檔名無效');
  const out = path.join(base, ...segs) + '.waxrack';
  const rel = path.relative(base, out);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('輸出路徑不在輸出資料夾內');
  return out;
});
ipcMain.handle('fs:readTags', async (_e, p) => {
  p = absPath(p, 'path');
  try {
    const { common, format } = await parseFile(p, { duration: true });
    const r = {};
    if (common.title) r.title = common.title;
    if (common.artist) r.artist = common.artist;
    if (common.album) r.album = common.album;
    if (common.track?.no) r.track = common.track.no;
    if (format.duration) r.duration = format.duration;
    const pic = common.picture?.[0];
    if (pic && pic.data.length <= MAX_COVER) r.cover = { mime: pic.format, data: new Uint8Array(pic.data) };
    return r;
  } catch { return {}; }
});
ipcMain.handle('fs:showInFolder', (_e, p) => { shell.showItemInFolder(absPath(p, 'path')); });

// ---- 單一執行個體：第二次啟動（例如再雙擊一個 .waxrack）交給已開的視窗 ----
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_e, argv) => { showWindow(); openFiles(filesFromArgv(argv)); });
  app.on('open-file', (e, p) => { e.preventDefault(); openFiles([p]); });   // macOS
  app.on('before-quit', () => { quitting = true; });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow(); createTray();
    openFiles(filesFromArgv(process.argv));
  });
  app.on('window-all-closed', () => app.quit());
}
