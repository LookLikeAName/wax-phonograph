// Electron 主程序：視窗、存檔對話框、開啟 .waxrack／音檔、系統匣、單一執行個體
// 畫面就是建置好的單一檔案 dist/index.html；網頁版與桌面版共用同一份程式，差異只在 src/platform/。
import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
