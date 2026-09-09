import { Browser, BrowserContext, Page } from 'playwright';
import Redis from 'ioredis';

/** 前端入口（nginx 静态托管，见 deploy/nginx.conf: listen 8080，/api 反代 3000） */
export const BASE = 'http://localhost:8080';
export const API = BASE + '/api/v1';
/** 与 frontend/src/store.js 的 TOKEN_KEY 保持一致 */
export const TOKEN_KEY = 'ats_token';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) redis = new Redis({ host: '127.0.0.1', port: 6379, lazyConnect: false });
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) { await redis.quit().catch(() => redis?.disconnect()); redis = null; }
}

/**
 * API 登录（绕开图形验证码的人读环节）：验证码 ID 走公开接口，验证码文本直接读 Redis
 * （CaptchaService 将明文小写存于 auth:captcha:{id}）。返回 JWT token。
 */
export async function apiLogin(username = 'admin', password = '123456'): Promise<string> {
  const capRes = await fetch(API + '/auth/captcha');
  const capBody = await capRes.json();
  if (capBody.code !== 0) throw new Error('获取验证码失败: ' + JSON.stringify(capBody));
  const { captcha_id } = capBody.data;
  const code = await getRedis().get('auth:captcha:' + captcha_id);
  if (!code) throw new Error('Redis 中未找到验证码 auth:captcha:' + captcha_id);

  const loginRes = await fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, captcha_id, captcha_code: code }),
  });
  const loginBody = await loginRes.json();
  if (loginBody.code !== 0) throw new Error('登录失败: ' + JSON.stringify(loginBody));
  return loginBody.data.token as string;
}

/** 以已登录态打开页面：注入 token 后再加载，App.vue 的 initAuth 会用该 token 调 /auth/me 恢复会话 */
export async function openLoggedInPage(browser: Browser, token: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(([k, v]) => localStorage.setItem(k, v as string), [TOKEN_KEY, token]);
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  return page;
}

/** 等待排查报告渲染完成，并返回 /troubleshoot 接口响应体（用于对 route/confidence 做断言） */
export async function runTroubleshoot(page: Page, text: string): Promise<any> {
  const respPromise = page.waitForResponse(
    (r) => r.url().includes('/api/v1/troubleshoot') && r.request().method() === 'POST',
    { timeout: 55_000 },
  );
  await page.locator('.ta textarea').fill(text);
  await page.getByRole('button', { name: '开始分析' }).click();
  const resp = await respPromise;
  const body = await resp.json();
  await page.locator('.conclusion-title').waitFor({ state: 'visible', timeout: 10_000 });
  return body;
}

/** 浏览器单例：每个 spec 文件 beforeAll 启动、afterAll 关闭 */
export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true });
}

export type { BrowserContext };
