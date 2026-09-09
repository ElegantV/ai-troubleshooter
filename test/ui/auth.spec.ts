import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser } from 'playwright';
import { BASE, closeRedis, getRedis, launchBrowser } from './helpers';

/**
 * 登录页 UI 流程（对应测试用例文档的登录相关条目）：
 * 打开首页 → 验证码加载 → 从 Redis 取验证码文本回填 → 提交 → 进入主界面。
 * 注：vitest 无 Playwright 的 web-first 断言（toBeVisible 等），统一用 waitFor/textContent。
 */

let browser: Browser;

beforeAll(async () => {
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser.close();
  await closeRedis();
});

describe('登录页', () => {
  it('验证码图片正常加载', async () => {
    const page = await browser.newPage();
    const capResp = page.waitForResponse((r) => r.url().includes('/api/v1/auth/captcha'), { timeout: 10_000 });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const resp = await capResp;
    expect(resp.status()).toBe(200);
    await page.locator('img.captcha-img').waitFor({ state: 'visible', timeout: 10_000 });
    await page.close();
  });

  it('验证码错误时登录被拒绝并提示', async () => {
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.locator('input[placeholder="小写字母/数字/下划线"]').fill('admin');
    await page.locator('input[placeholder="至少 6 位"]').fill('123456');
    await page.locator('input[placeholder="不区分大小写"]').fill('0000');
    await page.locator('.login-btn').click();
    // .login-err 为常驻占位元素（min-height 预留），需等待非空文案而非仅 visible
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.login-err');
        return el && el.textContent && el.textContent.trim().length > 0;
      },
      { timeout: 10_000 },
    );
    expect(await page.locator('.login-err').textContent()).toMatch(/验证码|失败|错误/);
    await page.close();
  });

  it('验证码正确时登录成功并进入主界面', async () => {
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    // 页面自行请求验证码，拦截响应拿到 captcha_id，再从 Redis 读出文本
    const capResp = await page.waitForResponse((r) => r.url().includes('/api/v1/auth/captcha'), { timeout: 10_000 });
    const { captcha_id } = (await capResp.json()).data;
    const code = await getRedis().get('auth:captcha:' + captcha_id);
    expect(code, '验证码文本应存在于 Redis').toBeTruthy();

    await page.locator('input[placeholder="小写字母/数字/下划线"]').fill('admin');
    await page.locator('input[placeholder="至少 6 位"]').fill('123456');
    await page.locator('input[placeholder="不区分大小写"]').fill(code!);
    await page.locator('.login-btn').click();

    // 登录成功后 LoginView 卸载，主界面「开始分析」出现
    await page.getByRole('button', { name: '开始分析' }).waitFor({ state: 'visible', timeout: 15_000 });
    await page.close();
  });
});
