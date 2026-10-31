// 把單一檔案的網頁版（dist/index.html）複製到 release/，檔名帶版本號，和桌面版放在一起
// 用法：npm run build 之後執行 node tools/copy_web.mjs（npm run dist:win 會自動執行）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'dist', 'index.html');
if (!fs.existsSync(src)) { console.error('找不到 dist/index.html，請先執行 npm run build'); process.exit(1); }
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const out = path.join(root, 'release', `WaxPhonograph-${version}-web.html`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(src, out);
console.log('網頁版：' + path.relative(root, out));
