// 桌面版（Electron）：透過 preload 注入的 window.phonoDesktop 呼叫主程序
export default {
  name: 'electron',
  // 跳出存檔對話框；回傳存檔路徑，使用者取消時回傳 null
  async saveFile(blob, name) { return window.phonoDesktop.saveFile(new Uint8Array(await blob.arrayBuffer()), name); },
  // 雙擊 .waxrack／音檔、或用「開啟檔案」交給本程式時收到 {name, data}
  onOpenFile(cb) { window.phonoDesktop.onOpenFile(cb); },
  // 系統匣選單的指令
  onCommand(cb) { window.phonoDesktop.onCommand(cb); },
  // 檔案系統（只有桌面版有）：工作區、批次轉換、音樂播放器用；路徑一律是絕對路徑，二進位資料是 Uint8Array
  fs: {
    pickFolder: () => window.phonoDesktop.fsPickFolder(),
    pickAudioFiles: () => window.phonoDesktop.fsPickAudioFiles(),
    pickOpenWorkspace: () => window.phonoDesktop.fsPickOpenWorkspace(),
    pickSaveWorkspace: defaultName => window.phonoDesktop.fsPickSaveWorkspace(defaultName),
    scanSources: sources => window.phonoDesktop.fsScanSources(sources),
    stat: p => window.phonoDesktop.fsStat(p),
    readFile: p => window.phonoDesktop.fsReadFile(p),
    writeFile: (p, data) => window.phonoDesktop.fsWriteFile(p, data),
    outputPath: (outDir, relNoExt) => window.phonoDesktop.fsOutputPath(outDir, relNoExt),
    readTags: p => window.phonoDesktop.fsReadTags(p),
    showInFolder: p => window.phonoDesktop.fsShowInFolder(p),
  },
};
