import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, setToken, getToken, auth } from './store';

/** Node 25 实验性 localStorage 会破坏 jsdom 的 Storage API，测试统一用内存 mock（更确定） */
function mockStorage() {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

describe('api() 统一请求封装', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', mockStorage());
    auth.user = null;
    auth.ready = false;
    auth.msg = '';
    vi.restoreAllMocks();
  });

  afterAll(() => vi.unstubAllGlobals());

  it('解包 {code:0,data} 返回 data', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ code: 0, data: { ok: true } }),
    });
    expect(await api('/health')).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/health', expect.anything());
  });

  it('注入 Authorization 头', async () => {
    setToken('tok123');
    global.fetch = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ code: 0, data: null }) });
    await api('/cases');
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer tok123');
  });

  it('code!=0 抛错并带服务端 message', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 409, json: async () => ({ code: 409, error: '已存在相同案例' }) });
    await expect(api('/cases')).rejects.toThrow('已存在相同案例');
  });

  it('401 清除会话并抛错', async () => {
    setToken('expired');
    global.fetch = vi.fn().mockResolvedValue({ status: 401, json: async () => ({ code: 401, error: '未登录' }) });
    await expect(api('/me')).rejects.toThrow();
    expect(getToken()).toBe('');
    expect(auth.user).toBeNull();
  });
});