/**
 * LLM 适配层（预留接口，原型默认关闭）
 * 接入方式：config.LLM 中填 OpenAI 兼容端点（行内网关 / 智谱 GLM / Ollama 均可）并置 enabled=true
 * 用途：候选原因复述与归纳、验证 SQL 润色、报告自然语言总结、动态存储过程血缘解析兜底
 */
const { LLM } = require('../config');

async function chat(messages, { temperature = 0.2 } = {}) {
  if (!LLM.enabled) return null;
  const resp = await fetch(`${LLM.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM.apiKey}` },
    body: JSON.stringify({ model: LLM.model, messages, temperature }),
  });
  if (!resp.ok) throw new Error(`LLM ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? null;
}

/** 报告增强：规则引擎产出候选原因后，由 LLM 归纳为自然语言结论（关闭时原样返回） */
async function enhanceReport(report) {
  if (!LLM.enabled) return report;
  try {
    const brief = report.sections.filter(s => s.key === 'causes').map(s => s.causes.map(c => c.title).join('；')).join('');
    const summary = await chat([
      { role: 'system', content: '你是数据仓库运维专家，用简洁中文归纳故障根因结论，不超过3句话。' },
      { role: 'user', content: `用户输入：${report.input}\n规则引擎候选原因：${brief}\n请输出一段综合结论。` },
    ]);
    if (summary) report.llmSummary = summary;
  } catch (e) {
    report.llmError = String(e.message);
  }
  return report;
}

module.exports = { chat, enhanceReport };
