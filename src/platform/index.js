// 平台抽象層：網頁版用瀏覽器 API；桌面版（Electron）會由 preload 注入 window.phonoDesktop，提供同樣的介面。
// 介面：name、saveFile(blob, 建議檔名) → Promise
import web from './web.js';
export const platform = (typeof window !== 'undefined' && window.phonoDesktop) || web;
