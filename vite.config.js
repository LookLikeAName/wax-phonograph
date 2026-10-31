// 建置成單一 HTML（JS、CSS、three.js 全部內嵌）：可以直接雙擊用 file:// 開、離線使用，也直接拿去部署
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },   // 主程式用到頂層 await
  server: { watch: { usePolling: !!process.env.VITE_POLL } },   // 收不到檔案變更通知的環境（例如網路磁碟、WSL 存取 Windows 磁碟）設 VITE_POLL=1 改用輪詢
});
