import { watch } from 'vue';
import { ui } from '../store';

/**
 * 列表类视图通用：切回本 tab 时重新拉数据。
 * 视图由 App.vue 的 v-if 挂载/销毁控制，本 watcher 兜底"重新激活时刷新"语义，
 * 避免各视图重复实现同一逻辑。
 * @param {string} tabName tab 名称（ui.activeTab 的值）
 * @param {() => void} onActivate 激活回调（通常为 load(0)）
 */
export function useTabReload(tabName, onActivate) {
  return watch(
    () => ui.activeTab,
    (v) => {
      if (v === tabName) onActivate();
    },
    { immediate: true },
  );
}