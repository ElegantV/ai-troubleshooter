// 布局审计：用 Playwright 分析页面样式 / 布局质量问题
// 用法：node scripts/layout-audit.mjs   （需先 npm run dev:ui 或后端托管在 localhost:3000）
import { chromium } from 'playwright';

const BASE = process.env.AUDIT_URL || 'http://localhost:3000/';
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

const AUDIT_JS = () => {
  const nodes = (sel) => { try { return [...document.querySelectorAll(sel)]; } catch { return []; } };
  const region = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { cls: (el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').toString().slice(0, 40), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), mb: s.marginBottom, mt: s.marginTop };
  };
  const sampleContrasts = (sels) => sels.map((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    return { sel, color: s.color, bg: s.backgroundColor, fontSize: s.fontSize, fw: s.fontWeight, text: (el.textContent || '').trim().slice(0, 16) };
  }).filter(Boolean);
  return {
  doc: {
    vw: document.documentElement.clientWidth,
    vh: document.documentElement.clientHeight,
    scrollW: document.documentElement.scrollWidth,
    scrollH: document.documentElement.scrollHeight,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  },
  // 超出视口右/下边缘的元素（容忍 1px）
  overflowEls: [...document.querySelectorAll('body *')].map((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    const visible = getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    if (!visible) return null;
    const right = r.right - document.documentElement.clientWidth;
    const bottom = r.bottom - document.documentElement.clientHeight;
    if (right > 1 || bottom > 1) {
      return {
        tag: el.tagName.toLowerCase(),
        cls: (el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').toString().slice(0, 60),
        text: (el.textContent || '').trim().slice(0, 30),
        right, bottom, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      };
    }
    return null;
  }).filter(Boolean).slice(0, 40),
  // 文本被裁剪（内容溢出容器但无滚动）
  clippedText: [...document.querySelectorAll('body *')].filter((el) => {
    const s = getComputedStyle(el);
    if (s.overflow !== 'visible') return false;
    return el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && (el.textContent || '').trim().length > 0;
  }).map((el) => ({
    tag: el.tagName.toLowerCase(),
    cls: (el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').toString().slice(0, 50),
    text: (el.textContent || '').trim().slice(0, 30),
    scrollW: el.scrollWidth, clientW: el.clientWidth,
  })).slice(0, 20),
  // 关键区域尺寸与对齐（用于核对间距一致性）
  regions: {
    hero: region(document.querySelector('.hero')),
    panels: nodes('.panel').map(region),
    chips: nodes('.chip').map(region),
    buttons: nodes('.el-button').map(region),
    textareas: nodes('.el-textarea__inner').map(region),
    tabs: nodes('.el-tabs__item').map(region),
  },
  // 对比度抽样：前景 vs 背景
  contrast: sampleContrasts(['.hero h1', '.hero .sub', '.chip', '.main .el-tabs__item', '.foot', 'body']),
  };
};

const report = [];
async function auditPage(page, ctx) {
  report.push(`\n===== ${ctx} =====`);
  const data = await page.evaluate(AUDIT_JS);
  const { doc, overflowEls, clippedText, regions, contrast } = data;

  if (doc.overflowX) {
    report.push(`[严重] 页面出现横向溢出：视口 ${doc.vw}px，内容宽 ${doc.scrollW}px（差 ${doc.scrollW - doc.vw}px）`);
    for (const o of overflowEls.filter((e) => e.right > 1).slice(0, 10))
      report.push(`  - 右溢 ${Math.round(o.right)}px: <${o.tag} .${o.cls}> "${o.text}" @x=${o.x} w=${o.w}`);
  } else {
    report.push(`[通过] 无横向溢出（视口 ${doc.vw}px / 内容 ${doc.scrollW}px）`);
  }
  const overflowY = overflowEls.filter((e) => e.bottom > 1);
  if (overflowY.length) {
    report.push(`[提示] ${overflowY.length} 个元素纵向超出视口（${overflowY.slice(0, 5).map((o) => `<${o.tag} .${o.cls}> ${Math.round(o.bottom)}px`).join('，')}）`);
  }
  if (clippedText.length) {
    report.push(`[提示] ${clippedText.length} 处文本疑似被裁剪（${clippedText.slice(0, 5).map((c) => `"${c.text}" ${c.scrollW}/${c.clientW}px`).join('，')}）`);
  }

  // 间距一致性：连续同组元素纵向间距
  for (const [key, raw] of Object.entries(regions)) {
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    const ys = list.filter(Boolean).map((r) => r.y);
    if (ys.length < 2) continue;
    const gaps = ys.slice(1).map((y, i) => y - (ys[i] + ((list[i] && list[i].h) || 0)));
    const uniq = [...new Set(gaps)];
    if (uniq.length > 2) report.push(`[提示] .${key} 组纵向间距不一致：${gaps.join(', ')}px`);
  }

  report.push(`[样本] 对比度/颜色抽样：`);
  for (const c of contrast) report.push(`  - ${c.sel}: 文字 ${c.color} on ${c.bg} (${c.fontSize}/${c.fw}) "${c.text}"`);

  const shot = `./scripts/shots/${ctx.replace(/[^a-z0-9]+/gi, '_')}.png`;
  await page.screenshot({ path: shot, fullPage: true });
  report.push(`[截图] ${shot}`);
}

const browser = await chromium.launch();
const page = await browser.newPage();

for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  const loginVisible = await page.locator('.el-dialog:visible').count();
  if (loginVisible) {
    await page.locator('.el-dialog input').nth(0).fill('admin');
    await page.locator('.el-dialog input').nth(1).fill('123456');
    await page.locator('.el-dialog .el-button--primary').click();
    await page.waitForTimeout(1200);
  }
  await page.waitForSelector('.hero', { timeout: 8000 });

  // 触发一次真实排查，渲染完整报告，审计最大内容
  await page.locator('textarea').fill('job_dwd_txnl_clean 昨晚失败了，报 ORA-01400，下游日报也没生成');
  await page.getByRole('button', { name: '开始分析' }).click();
  await page.waitForSelector('.cause, .el-alert', { timeout: 15000 });
  await page.waitForTimeout(2500);

  await auditPage(page, `${vp.name}-trouble`);

  for (const tab of ['能力图示', '案例库', '排查历史']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(1800);
    await auditPage(page, `${vp.name}-${tab}`);
  }
}

await browser.close();
process.stdout.write(report.join('\n') + '\n');