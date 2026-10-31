// preload：只開放少數固定的功能給畫面使用（contextIsolation＋sandbox，畫面本身碰不到 Node）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('phonoDesktop', {
  // data：Uint8Array；回傳實際存檔路徑，取消時回傳 null
  saveFile: (data, name) => ipcRenderer.invoke('save-file', { data, name }),
  // 雙擊檔案／從系統開啟時收到 {name, data}；註冊後才通知主程序可以送了
  onOpenFile: cb => { ipcRenderer.on('open-file', (_e, f) => cb(f)); ipcRenderer.send('renderer-ready'); },
  // 系統匣選單的指令：'toggle-play'、'stop'
  onCommand: cb => { ipcRenderer.on('command', (_e, c) => cb(c)); },
});
