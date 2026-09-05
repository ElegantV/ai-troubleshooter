import { createApp } from 'vue';
import { ElLoading } from 'element-plus';
// 显式 import 的编程式组件不会被 resolver 附带样式，需手动引入
import 'element-plus/es/components/loading/style/css';
import 'element-plus/es/components/message/style/css';
import App from './App.vue';

// Element Plus 模板组件改为 unplugin 按需引入（见 vite.config.js），
// v-loading 指令与 ElMessage 等编程式 API 的样式在上面手动引入
createApp(App).use(ElLoading).mount('#app');
