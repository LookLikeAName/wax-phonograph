// 桌面版（Electron）：透過 preload 注入的 window.phonoDesktop 呼叫主程序
export default {
  name: 'electron',
  // 跳出存檔對話框；回傳存檔路徑，使用者取消時回傳 null
  async saveFile(blob, name) { return window.phonoDesktop.saveFile(new Uint8Array(await blob.arrayBuffer()), name); },
  // 雙擊 .waxrack／音檔、或用「開啟檔案」交給本程式時收到 {name, data}
  onOpenFile(cb) { window.phonoDesktop.onOpenFile(cb); },
  // 系統匣選單的指令
  onCommand(cb) { window.phonoDesktop.onCommand(cb); },
};
