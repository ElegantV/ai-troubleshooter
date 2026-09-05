import { createApp } from 'vue';
import { ElLoading } from 'element-plus';
import 'element-plus/es/components/loading/style/css';
import App from './App.vue';

// Element Plus 组件改为 unplugin 按需引入（见 vite.config.js），
// 但 v-loading 指令不会被自动注册，需手动挂载
createApp(App).use(ElLoading).mount('#app');
