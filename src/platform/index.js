// 平台抽象層：網頁版用瀏覽器 API；桌面版（Electron）由 preload 注入 window.phonoDesktop。
// 介面：name、saveFile(blob, 建議檔名) → 存檔路徑或 null（取消）、onOpenFile(cb)?、onCommand(cb)?、fs?（檔案系統：選資料夾／掃描／讀寫／標籤等，網頁版是 undefined）（只有桌面版有）
import web from './web.js';
import electron from './electron.js';
export const platform = (typeof window !== 'undefined' && window.phonoDesktop) ? electron : web;
