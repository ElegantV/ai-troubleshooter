import { reactive } from 'vue';

const TOKEN_KEY = 'ats_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = t => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export const auth = reactive({ user: null, ready: false, loginVisible: false, mode: 'login', msg: '' });
export const ui = reactive({ activeTab: 'trouble', pendingInput: null });
export const meta = reactive({ data: null });

export const ROUTE_LABEL = { job_failure: '作业失败', data_anomaly: '数据异常', proc_analysis: '存储过程分析', other: '通用检索' };

/** 统一请求：自动带 token；401 时清除会话并弹出登录框 */
export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}) };
  const r = await fetch(path, { ...opts, headers });
  if (r.status === 401) {
    setToken('');
    auth.user = null;
    auth.msg = '未登录或会话已过期，请重新登录';
    auth.loginVisible = true;
    throw new Error('未登录');
  }
  return r.json();
}

export async function loadMeta() {
  try { meta.data = await api('/api/meta'); } catch (e) { /* 未登录时由 api() 统一处理 */ }
}

export async function initAuth() {
  if (!getToken()) { auth.loginVisible = true; auth.ready = true; return; }
  try {
    const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + getToken() } });
    if (r.ok) { auth.user = await r.json(); await loadMeta(); }
    else { setToken(''); auth.loginVisible = true; }
  } catch (e) { auth.loginVisible = true; }
  auth.ready = true;
}

export async function doLogin({ username, password, display_name }) {
  const path = auth.mode === 'login' ? 'login' : 'register';
  const r = await fetch('/api/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, display_name }),
  }).then(x => x.json());
  if (!r.ok && !r.token) throw new Error(r.message || r.error || '操作失败');
  setToken(r.token);
  auth.user = r.user;
  auth.loginVisible = false;
  auth.msg = '';
  await loadMeta();
  return r;
}

export async function logout() {
  try { await fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken() } }); } catch (e) {}
  setToken('');
  auth.user = null;
  auth.msg = '已退出登录';
  auth.loginVisible = true;
}

/** 能力图示/演示卡一键带入智能排查 */
export function tryInput(text) { ui.pendingInput = text; ui.activeTab = 'trouble'; }
