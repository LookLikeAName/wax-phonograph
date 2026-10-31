// preload：只開放少數固定的功能給畫面使用（contextIsolation＋sandbox，畫面本身碰不到 Node）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('phonoDesktop', {
  // data：Uint8Array；回傳實際存檔路徑，取消時回傳 null
  saveFile: (data, name) => ipcRenderer.invoke('save-file', { data, name }),
  // 雙擊檔案／從系統開啟時收到 {name, data}；註冊後才通知主程序可以送了
  onOpenFile: cb => { ipcRenderer.on('open-file', (_e, f) => cb(f)); ipcRenderer.send('renderer-ready'); },
  // 系統匣選單的指令：'toggle-play'、'stop'
  onCommand: cb => { ipcRenderer.on('command', (_e, c) => cb(c)); },
  // 檔案系統：每個功能一條固定通道，路徑與副檔名由主程序檢查
  fsPickFolder: () => ipcRenderer.invoke('fs:pickFolder'),
  fsPickAudioFiles: () => ipcRenderer.invoke('fs:pickAudioFiles'),
  fsPickOpenWorkspace: () => ipcRenderer.invoke('fs:pickOpenWorkspace'),
  fsPickSaveWorkspace: name => ipcRenderer.invoke('fs:pickSaveWorkspace', name),
  fsScanSources: sources => ipcRenderer.invoke('fs:scan', sources),
  fsStat: p => ipcRenderer.invoke('fs:stat', p),
  fsReadFile: p => ipcRenderer.invoke('fs:readFile', p),
  fsWriteFile: (p, data) => ipcRenderer.invoke('fs:writeFile', p, data),
  fsOutputPath: (dir, rel) => ipcRenderer.invoke('fs:outputPath', dir, rel),
  fsReadTags: p => ipcRenderer.invoke('fs:readTags', p),
  fsShowInFolder: p => ipcRenderer.invoke('fs:showInFolder', p),
});
