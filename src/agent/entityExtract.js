/**
 * 输入理解（原型：词典匹配；接入 LLM 后由 LLM 完成实体识别与现象归一化）
 */
const ANOMALY_KEYWORDS = ['异常', '骤降', '缺失', '为空', '偏少', '不对', '重复', ' NULL', 'null', '不一致', '波动'];
const FAIL_KEYWORDS = ['失败', '报错', 'error', 'skipped', '跳过', '未跑', '挂了'];

function extract(graph, text) {
  const t = String(text);
  const low = t.toLowerCase();
  const hit = (name) => low.includes(name.toLowerCase());

  const tables = graph.tables.filter(x => hit(x.name)).map(x => x.name);
  const jobs = graph.jobs.filter(x => hit(x.job_name) || (x.job_desc && t.includes(x.job_desc))).map(x => x.job_name);
  const columns = [...new Set(graph.columns.filter(c => new RegExp(`\\b${c.column_name}\\b`, 'i').test(low)).map(c => c.column_name))];

  let date = null;
  const dm = /(20\d{2})[-/年]?(\d{1,2})[-/月]?(\d{1,2})/.exec(t);
  if (dm) date = `${dm[1]}${String(dm[2]).padStart(2, '0')}${String(dm[3]).padStart(2, '0')}`;
  if (!date && /(昨天|昨晚)/.test(t)) {
    const latest = graph.db.prepare('SELECT MAX(run_date) AS d FROM job_runs').get().d;
    date = latest; // 原型日志只到最新一天
  }
  const errorCodeM = /ORA-\d{5}/.exec(t);

  // 场景路由：存储过程/SQL 分析 / 作业失败 / 数据异常
  let route = null;
  if (/insert\s+into[\s\S]{0,400}?select[\s\S]{0,2000}?\bfrom\b|create\s+procedure/i.test(t)) route = 'proc_analysis';
  else if (jobs.length || (FAIL_KEYWORDS.some(k => low.includes(k)) && !tables.length)) route = 'job_failure';
  else if (tables.length || columns.length || ANOMALY_KEYWORDS.some(k => low.includes(k))) route = 'data_anomaly';
  else if (FAIL_KEYWORDS.some(k => low.includes(k))) route = 'job_failure';

  return { tables, jobs, columns, date, errorCode: errorCodeM ? errorCodeM[0] : '', route, raw: t };
}

module.exports = { extract };
