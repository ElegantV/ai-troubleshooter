/**
 * 智能体编排层：固定工作流（可追溯）
 * 输入理解 → 场景路由 → 规则归因 + 图谱分析 → 案例检索融合 → 验证SQL → 报告组装 → (LLM增强)
 */
const crypto = require('crypto');
const { extract } = require('./entityExtract');
const rules = require('./rules');
const { analyzeProc } = require('./procAnalysis');
const { searchCases } = require('./retrieval');
const { buildVerifySql } = require('./verifySql');
const { enhanceReport } = require('./llm');

function toMarkdown(r) {
  const L = [`## 排查报告（${{ job_failure: '作业失败', data_anomaly: '数据异常', proc_analysis: '存储过程分析' }[r.route] || '通用检索'}）`, '',
    `**结论（置信度：${r.confidence}）**：${r.summary}`, ''];
  for (const s of r.sections) {
    L.push(`### ${s.title}`);
    if (s.key === 'causes') for (const c of s.causes) {
      L.push(`- **[${c.confidence}] ${c.title}**`);
      for (const e of c.evidence) L.push(`  - ${e}`);
    } else if (s.key === 'sql') for (const q of s.sqls) { L.push(`-- ${q.purpose}`); L.push('```sql'); L.push(q.sql); L.push('```'); }
    else if (s.key === 'structures') {
      for (const t of s.tables) {
        L.push(`- **${t.name}**${t.inKb ? '' : '（知识库外）'}${t.comment ? '：' + t.comment : ''}`);
        for (const c of t.columns) L.push(`  - ${c[0]} ${c[1]} ${c[2]} ${c[3]}`);
      }
    }
    else for (const i of s.items) L.push(`- ${i}`);
    L.push('');
  }
  return L.join('\n');
}

async function analyze(graph, text, user) {
  const db = graph.db;
  const ent = extract(graph, text);
  ent.date = ent.date || db.prepare('SELECT MAX(run_date) AS d FROM job_runs').get().d;

  let analysis;
  if (ent.route === 'job_failure') analysis = rules.analyzeJobFailure(db, graph, ent);
  else if (ent.route === 'data_anomaly') analysis = rules.analyzeDataAnomaly(db, graph, ent);
  else if (ent.route === 'proc_analysis') analysis = analyzeProc(graph, ent.raw || text);
  else analysis = { causes: [], impact: [], focusJobs: ent.jobs, focusTables: ent.tables, note: '未能识别场景，请补充异常表名、作业名或报错信息' };

  // 案例检索（工单+已沉淀案例，错误码/实体加权）
  const firstCode = ent.errorCode || (/ORA-\d{5}|SKIPPED/.exec(analysis.causes.map(c => c.title).join(' ')) || [''])[0];
  const caseHits = searchCases(db, text.length > 400 ? text.slice(0, 400) : text, {
    errorCode: firstCode,
    jobs: ent.jobs.length ? ent.jobs : analysis.focusJobs,
    tables: ent.tables.length ? ent.tables : analysis.focusTables,
  });
  for (const c of caseHits) {
    analysis.causes.push({
      type: c.kind === 'ticket' ? '历史工单' : '沉淀案例',
      title: `与历史案例 ${c.id} 高度相似：${c.title}`,
      score: Math.min(c.score, 9.8),
      evidence: [`现象：${c.symptom}`, `根因：${c.root_cause}`, ...c.boostReasons.map(x => `匹配依据：${x}`)],
      _case: c,
    });
  }
  analysis.causes.sort((a, b) => b.score - a.score);

  const verifySql = ent.route === 'proc_analysis'
    ? buildVerifySql(graph, analysis.verify || {})
    : buildVerifySql(graph, {
        focusTables: ent.tables.length ? ent.tables : analysis.focusTables,
        date: ent.date, prevDate: analysis.prevDate, columns: ent.columns,
      });

  const bestCase = caseHits[0];
  const solution = bestCase
    ? { source: `${bestCase.kind === 'ticket' ? '工单' : '案例'} ${bestCase.id}`, items: bestCase.solution.split(/[；;]/).filter(Boolean) }
    : { source: null, items: analysis.direction
        ? [...analysis.direction, '确认方向后，可在"案例库"页签把本次结论沉淀为案例']
        : analysis.causes.length
          ? ['按候选原因逐项执行验证SQL确认根因', '依据对应错误码处置手册操作', '处理完成后按作业链路自上而下逐级重跑下游，并校验各表当日分区行数']
          : ['请补充异常表名、作业名或粘贴报错日志后重试'] };

  const top = analysis.causes[0];
  const confidence = top ? (top.score >= 8.5 ? '高' : top.score >= 6.5 ? '中' : '低') : '无法判断';
  const routeName = { job_failure: '作业失败排查', data_anomaly: '数据异常排查', proc_analysis: '存储过程分析' }[ent.route] || '通用检索';
  const summary = top
    ? `已完成${routeName}（数据日期 ${ent.date}）。最可能原因：${top.title}`
    : (analysis.note || `已检索知识库（数据日期 ${ent.date}），未找到强匹配的候选原因，建议补充报错日志细节。`);

  const report = {
    query_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    input: text, entities: ent, route: ent.route, date: ent.date,
    confidence, summary,
    sections: [
      { key: 'impact', title: ent.route === 'proc_analysis' ? '对象识别与血缘链路' : '影响范围', items: analysis.impact.length ? analysis.impact : ['未识别到明确影响范围'] },
      { key: 'causes', title: ent.route === 'proc_analysis' ? '风险点与问题方向（SQL 静态分析）' : '候选原因（按置信度排序）', causes: analysis.causes.slice(0, 5).map(c => ({
          title: c.title, type: c.type, score: c.score,
          confidence: c.score >= 8.5 ? '高' : c.score >= 6.5 ? '中' : '低',
          evidence: c.evidence.slice(0, 5),
        })) },
      ...(analysis.structures && analysis.structures.length ? [{ key: 'structures', title: '相关表结构（来自知识库元数据）', tables: analysis.structures }] : []),
      { key: 'sql', title: `建议验证 SQL（只读，数据日期 ${ent.date}）`, sqls: verifySql },
      { key: 'solution', title: ent.route === 'proc_analysis' ? '建议排查方向' : '建议处置步骤', source: solution.source, items: solution.items },
      { key: 'refs', title: '参考案例', items: caseHits.map(c => `${c.id}《${c.title}》 匹配度 ${c.score}${c.boostReasons.length ? '（' + c.boostReasons.join('、') + '）' : ''}`) },
    ],
  };
  report.markdown = toMarkdown(report);

  // LLM 增强（原型默认关闭，规则+检索结果直接返回）
  await enhanceReport(report);

  // 审计留痕（记录操作人）
  graph.db.prepare('INSERT INTO query_log (query_id, created_at, input_text, entities_json, report_json, user_name) VALUES (?,?,?,?,?,?)')
    .run(report.query_id, report.created_at, text, JSON.stringify(ent), JSON.stringify(report), user || '');

  return report;
}

/** 反馈沉淀闭环：确认有效的排查结论自动写入案例库（归属到操作人） */
function saveFeedback(graph, { query_id, helpful, confirmed_cause, note }, user) {
  const db = graph.db;
  const row = db.prepare('SELECT * FROM query_log WHERE query_id=?').get(query_id);
  if (!row) return { ok: false, message: '查询记录不存在' };
  db.prepare('UPDATE query_log SET helpful=?, confirmed_cause=?, feedback_at=? WHERE query_id=?')
    .run(helpful, confirmed_cause || '', new Date().toISOString(), query_id);

  if (helpful === 'yes' && confirmed_cause) {
    const ent = JSON.parse(row.entities_json);
    const report = JSON.parse(row.report_json);
    const caseId = 'CASE-' + Date.now();
    db.prepare('INSERT INTO cases (case_id, symptom, root_cause, solution, related_jobs, related_tables, error_code, source, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      caseId,
      row.input_text,
      confirmed_cause,
      note || report.sections.find(s => s.key === 'solution')?.items?.join('；') || '',
      JSON.stringify(ent.jobs || []), JSON.stringify(ent.tables || []),
      ent.errorCode || '', '用户反馈沉淀', new Date().toISOString(), user || row.user_name || '',
    );
    return { ok: true, caseId, message: `反馈已记录，并已沉淀为案例 ${caseId}，后续排查将自动关联` };
  }
  return { ok: true, message: '反馈已记录' };
}

module.exports = { analyze, saveFeedback };
