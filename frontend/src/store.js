import { reactive } from 'vue';

const TOKEN_KEY = 'ats_token';
const API = '/api/v1';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = t => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export const auth = reactive({ user: null, ready: false, loginVisible: false, mode: 'login', msg: '' });
export const ui = reactive({ activeTab: 'trouble', pendingInput: null });
export const meta = reactive({ data: null });

/** 视口断点（跟随窗口，供表格/网格按需隐藏列）。bp: 'sm' < 720 | 'md' < 1024 | 'lg' */
export const vp = reactive({ w: 0, bp: 'lg' });
const bpOf = w => (w < 720 ? 'sm' : w < 1024 ? 'md' : 'lg');
if (typeof window !== 'undefined') {
  const apply = () => { vp.w = window.innerWidth; vp.bp = bpOf(window.innerWidth); };
  apply();
  window.addEventListener('resize', apply);
}

export const ROUTE_LABEL = { job_failure: '作业失败', data_anomaly: '数据异常', proc_analysis: '存储过程分析', other: '通用检索' };

/**
 * 统一请求：/api/v1 前缀 + {code,data,error} 包络解包。
 * 成功返回 data；401 时清除会话并弹出登录框；code!=0 抛错。
 */
export async function api(path, opts = {}) {
  const url = path.startsWith('http') ? path : API + path;
  const headers = { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}) };
  const r = await fetch(url, { ...opts, headers });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401 || body.code === 401) {
    setToken('');
    auth.user = null;
    auth.msg = '未登录或会话已过期，请重新登录';
    auth.loginVisible = true;
    throw new Error('未登录');
  }
  if (body.code !== undefined) {
    if (body.code !== 0) throw new Error(body.error || '操作失败');
    return body.data;
  }
  return body;
}

export async function loadMeta() {
  try { meta.data = await api('/meta'); } catch (e) { /* 未登录时由 api() 统一处理 */ }
}

export async function initAuth() {
  if (!getToken()) { auth.loginVisible = true; auth.ready = true; return; }
  try {
    const user = await api('/auth/me');
    auth.user = user;
    await loadMeta();
  } catch (e) { setToken(''); auth.loginVisible = true; }
  auth.ready = true;
}

export async function doLogin({ username, password, display_name, system_code }) {
  const path = auth.mode === 'login' ? 'login' : 'register';
  const r = await api('/auth/' + path, {
    method: 'POST',
    body: JSON.stringify({ username, password, display_name, system_code }),
  });
  if (!r.ok && !r.token) throw new Error(r.message || r.error || '操作失败');
  setToken(r.token);
  auth.user = r.user;
  auth.loginVisible = false;
  auth.msg = '';
  await loadMeta();
  return r;
}

export async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) {}
  setToken('');
  auth.user = null;
  auth.msg = '已退出登录';
  auth.loginVisible = true;
}

/** 能力图示/演示卡一键带入智能排查 */
export function tryInput(text) { ui.pendingInput = text; ui.activeTab = 'trouble'; }

/** Element Plus 的列宽只接受数字（px），这里把 rem 换算后传入，源码保持相对单位 */
export const colW = rem =>
  Math.round(rem * (typeof getComputedStyle === 'function'
    ? parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    : 16));