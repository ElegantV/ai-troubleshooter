const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0', timeout: 20000 });

  // 登录
  await page.waitForSelector('.el-dialog input', { timeout: 8000 });
  const inputs = await page.$$('.el-dialog input');
  await inputs[0].type('admin');
  await inputs[1].type('123456');
  await (await page.$('.el-dialog button')).click();
  await new Promise((r) => setTimeout(r, 1500));

  // 输入并快速双击「开始分析」
  const marker = '双击测试_' + Date.now().toString().slice(-6);
  await page.type('textarea', marker + ' 作业 job_dws_asset_agg 失败');
  const btns = await page.$$('button');
  let goBtn = null;
  for (const b of btns) { const t = await b.evaluate((e) => e.textContent); if (t.trim() === '开始分析') { goBtn = b; break; } }
  // 快速双击：两次点击间隔 ~80ms（在 busy 生效窗口内）
  await goBtn.click();
  await new Promise((r) => setTimeout(r, 80));
  await goBtn.click();
  await new Promise((r) => setTimeout(r, 9000));

  // 通过 API 查询该输入的审计记录数
  const count = await page.evaluate(async (marker) => {
    const token = localStorage.getItem('ats_token');
    const r = await fetch('/api/v1/queries?limit=100&offset=0', { headers: { Authorization: 'Bearer ' + token } });
    const d = await r.json();
    return d.data.items.filter((x) => x.input.includes(marker)).length;
  }, marker);

  console.log('=== 双击后该输入的审计记录数:', count, '(期望 1)');
  console.log('=== 页面错误:', errors.length ? errors.join(' ; ') : '无');
  await browser.close();
})();