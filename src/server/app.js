/** 应用服务层：node src/server/app.js */
const express = require('express');
const path = require('path');
const { PORT } = require('../config');
const { loadGraph } = require('../agent/graphQuery');
const { analyze, saveFeedback } = require('../agent/workflow');
const auth = require('../auth');

const graph = loadGraph();
auth.ensureAuthSchema(graph.db);
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', '..', 'public')));

// ---- 认证 ----
// POST 路由表：统一以动词动态挂载，便于集中维护与后续加限流/审计中间件
const route = (verb, routePath, ...handlers) => app[verb](routePath, ...handlers);

route('post', '/api/register', (req, res) => res.json(auth.register(graph.db, req.body || {})));
route('post', '/api/login', (req, res) => res.json(auth.login(graph.db, req.body || {})));
route('post', '/api/logout', (req, res) => {
  auth.logout(graph.db, String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = auth.resolveUser(graph.db, token);
  if (!user) return res.status(401).json({ needLogin: true });
  res.json(user);
});

// 探活（开放，供运维/脚本不登录检查服务与知识库状态）
const n = (t) => graph.db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: '0.3.0', kb: { tables: n('meta_tables'), jobs: n('jobs'), tickets: n('tickets'), cases: n('cases') } });
});

// 以下所有接口需登录（操作归属：案例/审计记录落到人）
app.use('/api', auth.requireAuth(graph.db));

// ---- 排查历史（审计留痕可视化：谁在何时查了什么、结论如何） ----
app.get('/api/queries', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const total = graph.db.prepare('SELECT COUNT(*) AS c FROM query_log').get().c;
  const items = graph.db.prepare(
    'SELECT query_id, created_at, user_name, input_text, report_json FROM query_log ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset).map(r => {
    const rep = JSON.parse(r.report_json || '{}');
    return {
      query_id: r.query_id, created_at: r.created_at, user: r.user_name || '-', input: r.input_text,
      route: rep.route || 'other', confidence: rep.confidence || '-', summary: rep.summary || '',
    };
  });
  res.json({ total, items });
});

app.get('/api/queries/:id', (req, res) => {
  const row = graph.db.prepare('SELECT * FROM query_log WHERE query_id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '查询记录不存在' });
  res.json({
    query_id: row.query_id, created_at: row.created_at, user: row.user_name || '-',
    helpful: row.helpful || '', confirmed_cause: row.confirmed_cause || '',
    report: JSON.parse(row.report_json),
  });
});

app.get('/api/meta', (req, res) => {
  const latest = graph.db.prepare('SELECT MAX(run_date) AS d FROM job_runs').get().d;
  const failed = graph.db.prepare("SELECT job_name, final_status FROM job_runs WHERE run_date=? AND final_status!='SUCCESS'").all(latest);
  res.json({
    tables: n('meta_tables'), jobs: n('jobs'),
    lineageEdges: n('table_lineage'), tickets: n('tickets'),
    cases: n('cases'), latestRunDate: latest, abnormalJobs: failed,
  });
});

// 表单字典：作业/表/错误码自动补全
app.get('/api/dict', (req, res) => {
  res.json({
    tables: graph.tables.map(t => ({ name: t.name, comment: t.comment })),
    jobs: graph.jobs.map(j => ({ name: j.job_name, desc: j.job_desc })),
    errorCodes: graph.db.prepare('SELECT code, meaning FROM error_codes ORDER BY code').all(),
  });
});

// 血缘/链路图数据（能力图示页）
app.get('/api/graph', (req, res) => {
  res.json({
    jobs: graph.jobs.map(j => ({ name: j.job_name, desc: j.job_desc, layer: j.layer, schedule: j.schedule })),
    tables: graph.tables.map(t => ({ name: t.name, layer: t.name.split('_')[0].toUpperCase(), comment: t.comment })),
    jobDeps: graph.deps,
    tlineage: graph.lineage.map(e => ({ src: e.src_table, tgt: e.tgt_table, proc: e.proc_name, job: e.via_job })),
  });
});

// 三大能力的真实关联演示（取自知识库实际数据）
app.get('/api/demos', (req, res) => {
  const latest = graph.db.prepare('SELECT MAX(run_date) AS d FROM job_runs').get().d;
  const st = {};
  for (const r of graph.db.prepare('SELECT job_name, final_status FROM job_runs WHERE run_date=?').all(latest)) st[r.job_name] = r.final_status;
  const chainSteps = ['job_ods_cust_info_load', 'job_dim_cust_sync', 'job_dwd_txnl_clean', 'job_dws_asset_agg', 'job_ads_rpt_gen']
    .map((j, i) => `${i === 0 ? j : '→ ' + j}：${st[j] || '无记录'}${i === 0 ? '（FTP-TIMEOUT 客户信息文件等待超时）' : i === 4 ? '（日报未产出）' : '（上游失败被调度跳过）'}`);
  res.json({
    latestRunDate: latest,
    lineageDemo: {
      title: '血缘关联 · 数据异常沿血缘溯源',
      scenario: `ADS 客户资产日报（ads_cust_asset_rpt）数字偏低，业务投诉，需要定位是哪一层算错`,
      steps: [
        'ads_cust_asset_rpt ← proc_ads_rpt_gen ← dws_cust_asset_d',
        'dws_cust_asset_d ← proc_dws_asset_agg ← dwd_txnl_detail_d ⊕ ods_acct_bal ⊕ dim_cust',
        'dwd_txnl_detail_d ← proc_dwd_txnl_clean ← ods_txnl_detail ⊕ dim_cust',
        '排查动作：对每层表执行"当日 vs 前日"分区行数对比，行数在哪一层骤减，问题就在该层加工作业或其上游',
      ],
      usage: '血缘回答"数据从哪来、被谁用"，把单表异常放大为整条数据链的核查路径',
      try: 'ads_cust_asset_rpt 没有最新数据，业务取数报错',
    },
    chainDemo: {
      title: '作业链路 · 失败根因与级联影响',
      scenario: `${latest} 跑批：客户信息源文件延迟，一条链路 5 个作业级联异常`,
      steps: chainSteps,
      usage: '链路回答"作业之间谁依赖谁"：根因必在链路最上游；修复后须按 DAG 自上而下逐级重跑，否则下游基于旧数据（历史案例 TKT-2025-0412）',
      try: 'job_ods_cust_info_load 昨天文件超时失败',
    },
    caseDemo: {
      title: '案例关联 · 历史经验复用',
      scenario: '作业报 ORA-01400，输入包含错误码 + 作业名 + 表名',
      steps: [
        '实体识别：错误码 ORA-01400、作业 job_dwd_txnl_clean、表 dwd_txnl_detail_d',
        '检索加权命中历史工单 TKT-2026-0158：错误码匹配 +3、关联作业 +2.5、关联表 +2 → 综合置信度"高"',
        '直接复用工单结论：根因（源文件格式变更致 CUST_ID 为空）+ 4 步处置流程',
        '用户反馈确认后自动沉淀为新案例，案例库越用越准（数据飞轮）',
      ],
      usage: '案例关联回答"以前谁遇到过、怎么解决的"，把个人经验变成团队资产',
      try: 'job_dwd_txnl_clean 昨晚失败了，报 ORA-01400',
    },
  });
});

route('post', '/api/troubleshoot', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: '请输入异常表、字段、失败作业或现象描述' });
  if (text.length > 5000) return res.status(400).json({ error: '输入过长（上限 5000 字符），请粘贴关键报错片段或补充说明' });
  try {
    res.json(await analyze(graph, text, req.user.username));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '排查失败：' + e.message });
  }
});

route('post', '/api/feedback', (req, res) => {
  const b = req.body || {};
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(b.query_id || ''))) {
    return res.status(400).json({ ok: false, message: 'query_id 格式无效' });
  }
  if (!['yes', 'no'].includes(b.helpful)) return res.status(400).json({ ok: false, message: 'helpful 仅支持 yes/no' });
  res.json(saveFeedback(graph, b, req.user.username));
});

const splitList = (s) => String(s || '').split(/[,，;；、\s]+/).map(x => x.trim()).filter(Boolean);

/** 案例录入：用户把已解决的问题沉淀进知识库 */
route('post', '/api/cases', (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const symptom = String(b.symptom || '').trim();
  const root_cause = String(b.root_cause || '').trim();
  const solution = String(b.solution || '').trim();
  if (!title || !symptom || !root_cause || !solution) {
    return res.status(400).json({ error: '案例标题、问题现象、根因分析、解决方式均为必填' });
  }
  const db = graph.db;
  const dup = db.prepare('SELECT case_id FROM cases WHERE symptom=? OR (symptom=? AND root_cause=?)').get(symptom, symptom, root_cause);
  if (dup) return res.status(409).json({ error: `知识库中已存在相同现象的案例（${dup.case_id}），无需重复录入` });

  // 自动识别关联作业/表/错误码（用户填写的优先，识别到的补充）
  const blob = `${title} ${symptom} ${root_cause}`;
  const blobLow = blob.toLowerCase();
  const autoJobs = graph.jobs.map(j => j.job_name).filter(j => blobLow.includes(j.toLowerCase()) || (j.job_desc && blob.includes(j.job_desc)));
  const autoTables = graph.tables.map(t => t.name).filter(t => blobLow.includes(t));
  const codes = db.prepare('SELECT code FROM error_codes').all().map(r => r.code);
  const autoCode = codes.find(c => blob.includes(c)) || /ORA-\d{5}/.exec(blob)?.[0] || '';
  const jobs = [...new Set([...splitList(b.related_jobs), ...autoJobs])];
  const tables = [...new Set([...splitList(b.related_tables), ...autoTables])];
  const errorCode = String(b.error_code || '').trim().toUpperCase() || autoCode;

  const caseId = 'CASE-' + Date.now();
  db.prepare('INSERT INTO cases (case_id, symptom, root_cause, solution, related_jobs, related_tables, error_code, source, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    caseId, symptom, root_cause, solution,
    JSON.stringify(jobs), JSON.stringify(tables), errorCode,
    '人工录入', new Date().toISOString(), req.user.username,
  );
  res.json({ ok: true, caseId, auto_detected: { jobs: autoJobs, tables: autoTables, error_code: autoCode || null } });
});

app.get('/api/cases', (req, res) => {
  const rows = graph.db.prepare('SELECT * FROM cases ORDER BY created_at DESC').all().map(c => ({
    case_id: c.case_id, symptom: c.symptom, root_cause: c.root_cause, solution: c.solution,
    related_jobs: JSON.parse(c.related_jobs || '[]'), related_tables: JSON.parse(c.related_tables || '[]'),
    error_code: c.error_code || '', source: c.source, created_at: c.created_at, created_by: c.created_by || '',
  }));
  res.json(rows);
});

// API 兜底：未知接口返回 JSON 而非静态页；全局错误统一 JSON 输出
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '服务异常：' + err.message });
});

app.listen(PORT, () => {
  console.log(`AI 问题排查助手（原型）已启动: http://localhost:${PORT}`);
});
