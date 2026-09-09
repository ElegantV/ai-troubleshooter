import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser, Page } from 'playwright';
import { apiLogin, closeRedis, launchBrowser, openLoggedInPage, runTroubleshoot } from './helpers';

/**
 * 智能排查 UI 用例（对应测试用例文档模块A 输入路由 / 模块B-D 排查）：
 * 每个用例独立上下文，通过对 /troubleshoot 接口响应与报告渲染做双重断言。
 * 测试数据与 scripts/run-cases.cjs、docs/测试用例-AI问题排查助手.xlsx 一致。
 * 注：vitest 无 Playwright 的 web-first 断言（toBeVisible 等），统一用 waitFor/textContent。
 */

const SQL_CASE =
  "INSERT INTO dwd_txnl_detail_d (txnl_id, cust_id, acct_no, txnl_type, txnl_amt, txnl_dt, data_dt)\n" +
  "SELECT t.txnl_id, c.cust_id, t.acct_no, t.txnl_type, t.txnl_amt, t.txnl_dt, '20260903'\n" +
  "FROM ods_txnl_detail t\nLEFT JOIN dim_cust c ON t.acct_no = c.acct_no;";

let browser: Browser;
let token: string;

beforeAll(async () => {
  browser = await launchBrowser();
  token = await apiLogin();
});

afterAll(async () => {
  await browser.close();
  await closeRedis();
});

/** 打开已登录页面，等主界面就绪后返回 page */
async function openMain(): Promise<Page> {
  const page = await openLoggedInPage(browser, token);
  await page.getByRole('button', { name: '开始分析' }).waitFor({ state: 'visible', timeout: 15_000 });
  return page;
}

describe('输入路由（模块A）', () => {
  it('TC-RT-001 作业失败描述路由到作业失败排查，置信度非空', async () => {
    const page = await openMain();
    const body = await runTroubleshoot(page, 'job_dwd_txnl_clean 昨晚失败了，报 ORA-01400，下游日报也没生成');
    expect(body.code).toBe(0);
    expect(body.data.route).toBe('job_failure');
    expect(body.data.confidence).toBeTruthy();
    await page.locator('.conclusion-text').waitFor({ state: 'visible', timeout: 10_000 });
    expect((await page.locator('.conclusion-text').textContent())?.trim().length).toBeGreaterThan(0);
    await page.close();
  });

  it('TC-RT-002 表名+数据量骤降路由到数据异常排查', async () => {
    const page = await openMain();
    const body = await runTroubleshoot(page, 'dws_cust_asset_d 昨天数据量骤降，客户资产汇总缺失');
    expect(body.data.route).toBe('data_anomaly');
    await page.close();
  });

  it('TC-RT-003 存储过程 SQL 路由到存储过程分析', async () => {
    const page = await openMain();
    const body = await runTroubleshoot(page, SQL_CASE);
    expect(body.data.route).toBe('proc_analysis');
    await page.close();
  });

  it('C7 边缘场景：无关输入路由到通用检索且不报错', async () => {
    const page = await openMain();
    const body = await runTroubleshoot(page, '我的电脑蓝屏了怎么办');
    expect(body.code).toBe(0);
    expect(body.data.route).toBe('other');
    await page.close();
  });
});

describe('排查报告（模块B-D）', () => {
  it('TC-RT-001 报告含候选原因区块，验证 SQL 均为只读', async () => {
    const page = await openMain();
    const body = await runTroubleshoot(page, 'job_dwd_txnl_clean 昨晚失败了，报 ORA-01400，下游日报也没生成');
    // 候选原因区块（二级标题）在页面上渲染
    await page.locator('.sec-h2').first().waitFor({ state: 'visible', timeout: 10_000 });
    // 建议验证 SQL 只读性：接口返回的 sql 区块不应含写操作关键字
    const sqlSec = (body.data.sections || []).find((s: any) => s.key === 'sql');
    for (const q of sqlSec?.sqls || []) {
      expect(q.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i);
    }
    // 页面上渲染出的 SQL 同样只读（pre.sql 覆盖 sql 区块与 AI 验证 SQL）
    for (const q of await page.locator('.panel pre.sql').allTextContents()) {
      expect(q).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i);
    }
    await page.close();
  });

  it('TC-PA-001 存储过程分析触发 LEFT JOIN 空值风险', async () => {
    const page = await openMain();
    const body = await runTroubleshoot(page, SQL_CASE);
    expect(JSON.stringify(body.data)).toContain('LEFT JOIN');
    await page.close();
  });
});
