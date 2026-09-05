import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

// 构建产物输出到 ../public，由 nginx 静态托管；
// 开发时 npm run dev 走 5173，/api 代理到 3000 的后端
export default defineConfig({
  plugins: [
    vue(),
    // Element Plus 按需引入：模板中的 el-* 组件与 ElMessage 等 API 自动按需注册/带样式
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] }),
  ],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  build: { outDir: '../public', emptyOutDir: true },
});
