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

  await page.waitForSelector('.el-dialog input', { timeout: 8000 });
  const inputs = await page.$$('.el-dialog input');
  await inputs[0].type('admin');
  await inputs[1].type('123456');
  await (await page.$('.el-dialog button')).click();
  await new Promise((r) => setTimeout(r, 1500));

  await page.type('textarea', 'job_dws_asset_agg 失败，报 ORA-00060 死锁');
  const btns = await page.$$('button');
  for (const b of btns) { const t = await b.evaluate((e) => e.textContent); if (t.trim() === '开始分析') { await b.click(); break; } }
  await new Promise((r) => setTimeout(r, 12000));

  const before = await page.evaluate(() => {
    const ai = document.querySelector('.ai-card');
    return {
      aiCard: !!ai,
      aiCause: ai ? ai.textContent.slice(0, 120) : '',
      adoptBtn: [...document.querySelectorAll('button')].some((b) => b.innerText.includes('采纳此结论')),
    };
  });
  console.log('=== AI 综合分析卡 ===', JSON.stringify(before, null, 2));

  // 点击「采纳此结论」
  if (before.adoptBtn) {
    const btns2 = await page.$$('button');
    for (const b of btns2) { const t = await b.evaluate((e) => e.textContent); if (t.includes('采纳此结论')) { await b.click(); break; } }
    await new Promise((r) => setTimeout(r, 2000));
    const done = await page.evaluate(() => document.body.innerText.includes('采纳后') === false && document.body.innerText.includes('已沉淀') || document.body.innerText.includes('反馈'));
    console.log('=== 采纳按钮点击后（反馈已提交）:', done);
  }
  console.log('=== 页面错误:', errors.length ? errors.join(' ; ') : '无');
  await browser.close();
})();