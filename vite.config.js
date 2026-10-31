// 建置成單一 HTML（JS、CSS、three.js 全部內嵌）：可以直接雙擊用 file:// 開、離線使用，也直接拿去部署
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },   // 「關於」顯示的版本號
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },   // 主程式用到頂層 await
  server: { watch: { usePolling: !!process.env.VITE_POLL } },   // 收不到檔案變更通知的環境（例如網路磁碟、WSL 存取 Windows 磁碟）設 VITE_POLL=1 改用輪詢
});
