import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 构建产物输出到 ../public，由 Express 直接静态托管；
// 开发时 npm run dev 走 5173，/api 代理到 3000 的后端
export default defineConfig({
  plugins: [vue()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  build: { outDir: '../public', emptyOutDir: true },
});
