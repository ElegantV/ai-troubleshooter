/**
 * 数据采集层（原型：读取 data/raw 下模拟的行内数据源，写入 SQLite）
 * 真实环境替换为：元数据平台 / 调度系统API / 日志平台 / 工单系统API / 版本库
 */
const fs = require('fs');
const path = require('path');
const { RAW_DIR } = require('../config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta_tables(name TEXT PRIMARY KEY, layer TEXT, comment TEXT);
CREATE TABLE IF NOT EXISTS meta_columns(table_name TEXT, column_name TEXT, data_type TEXT, nullable TEXT, comment TEXT);
CREATE TABLE IF NOT EXISTS jobs(job_name TEXT PRIMARY KEY, job_desc TEXT, proc_name TEXT, layer TEXT, schedule TEXT);
CREATE TABLE IF NOT EXISTS job_deps(job_name TEXT, depends_on TEXT);
CREATE TABLE IF NOT EXISTS proc_lineage(proc_name TEXT, src_table TEXT, tgt_table TEXT);
CREATE TABLE IF NOT EXISTS table_lineage(src_table TEXT, tgt_table TEXT, proc_name TEXT, via_job TEXT);
CREATE TABLE IF NOT EXISTS batch_logs(run_date TEXT, ts TEXT, job_name TEXT, level TEXT, message TEXT, error_code TEXT, line_no INTEGER);
CREATE TABLE IF NOT EXISTS job_runs(run_date TEXT, job_name TEXT, final_status TEXT, rows_loaded INTEGER);
CREATE TABLE IF NOT EXISTS error_codes(code TEXT PRIMARY KEY, meaning TEXT, typical_cause TEXT);
CREATE TABLE IF NOT EXISTS tickets(ticket_id TEXT PRIMARY KEY, title TEXT, symptom TEXT, root_cause TEXT, solution TEXT, related_jobs TEXT, related_tables TEXT, error_code TEXT);
CREATE TABLE IF NOT EXISTS cases(case_id TEXT PRIMARY KEY, symptom TEXT, root_cause TEXT, solution TEXT, related_jobs TEXT, related_tables TEXT, error_code TEXT, source TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS query_log(query_id TEXT PRIMARY KEY, created_at TEXT, input_text TEXT, entities_json TEXT, report_json TEXT, helpful TEXT, confirmed_cause TEXT, feedback_at TEXT);
`;

/** 解析 DDL 文件：CREATE TABLE 块 → 元数据表/列 */
function parseDdl(sql) {
  const tables = [];
  const blockRe = /CREATE\s+TABLE\s+([a-zA-Z_][\w]*)\s*\(([\s\S]*?)\)\s*COMMENT='([^']*)'/gi;
  let m;
  while ((m = blockRe.exec(sql))) {
    const name = m[1].toLowerCase();
    const comment = m[3];
    const cols = [];
    // 列定义逐行拆分（最后一个逗号后跟 COMMENT= 表注释的不含在内，块内按逗号+换行粗切）
    const body = m[2];
    const colRe = /([a-zA-Z_][\w]*)\s+([A-Z]+(?:\(\d+(?:,\d+)?\))?)\s*(NOT NULL)?\s*(?:COMMENT\s+'([^']*)')?/gi;
    const lines = body.split(/,\s*\n/);
    for (const line of lines) {
      const l = line.trim();
      if (!l || /^(PRIMARY|UNIQUE|CONSTRAINT|FOREIGN)/i.test(l)) continue;
      const cm = /^([a-zA-Z_][\w]*)\s+([A-Z]+(?:\(\d+(?:,\d+)?\))?)[^']*?(?:COMMENT\s+'([^']*)')?\s*(NOT NULL)?\s*$/i.exec(l);
      if (cm) {
        cols.push({
          column_name: cm[1].toLowerCase(),
          data_type: cm[2].toUpperCase(),
          nullable: cm[4] ? 'N' : 'Y',
          comment: (cm[3] || '').replace(/；.*$/, ''),
        });
      }
    }
    // 主键列视为非空（供静态风险分析使用）
    const pk = /primary\s+key\s*\(([^)]*)\)/i.exec(body);
    if (pk) {
      for (const c of pk[1].split(',')) {
        const col = cols.find(x => x.column_name === c.trim().toLowerCase());
        if (col) col.nullable = 'N';
      }
    }
    tables.push({ name, comment, cols });
  }
  return tables;
}

/** 解析跑批日志行：[ts] LEVEL job message */
function parseLogLine(line, runDate, lineNo) {
  const m = /^\[([\d\- :]+)\]\s+(INFO|WARN|ERROR)\s+([a-zA-Z_][\w]*)\s+(.*)$/.exec(line.trim());
  if (!m) return null;
  const message = m[4];
  const oraM = /ORA-\d{5}/.exec(message);
  const error_code = oraM ? oraM[0] : (/SKIPPED/.test(message) ? 'SKIPPED' : '');
  return {
    run_date: runDate, ts: m[1].trim(), job_name: m[3], level: m[2],
    message, error_code, line_no: lineNo,
  };
}

/** 从日志聚合每个作业当日最终状态与加载行数 */
function aggregateJobRuns(logs) {
  const runs = new Map();
  for (const l of logs) {
    const key = `${l.run_date}|${l.job_name}`;
    if (!runs.has(key)) runs.set(key, { run_date: l.run_date, job_name: l.job_name, final_status: 'RUNNING', rows_loaded: null });
    const r = runs.get(key);
    if (/SKIPPED/.test(l.message)) r.final_status = 'SKIPPED';
    if (/FAILED/.test(l.message) && l.level === 'ERROR') r.final_status = 'FAILED';
    if (/SUCCESS/.test(l.message)) r.final_status = 'SUCCESS';
    const rm = /rows_loaded=(\d+)/.exec(l.message);
    if (rm) r.rows_loaded = parseInt(rm[1], 10);
  }
  return [...runs.values()];
}

function collect(db) {
  db.exec(SCHEMA);
  db.exec(`DELETE FROM meta_tables; DELETE FROM meta_columns; DELETE FROM jobs; DELETE FROM job_deps;
           DELETE FROM batch_logs; DELETE FROM job_runs; DELETE FROM error_codes; DELETE FROM tickets;`);

  // 1. 表结构元数据（真实环境：元数据平台接口）
  const ddl = fs.readFileSync(path.join(RAW_DIR, 'ddl.sql'), 'utf8');
  const insTable = db.prepare('INSERT INTO meta_tables VALUES (?,?,?)');
  const insCol = db.prepare('INSERT INTO meta_columns VALUES (?,?,?,?,?)');
  for (const t of parseDdl(ddl)) {
    insTable.run(t.name, t.name.split('_')[0].toUpperCase(), t.comment);
    for (const c of t.cols) insCol.run(t.name, c.column_name, c.data_type, c.nullable, c.comment);
  }

  // 2. 调度依赖（真实环境：调度系统 API 导出 DAG）
  const dag = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'dag.json'), 'utf8'));
  const insJob = db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?)');
  for (const j of dag.jobs) insJob.run(j.job_name, j.job_desc, j.proc_name, j.layer, j.schedule);
  const insDep = db.prepare('INSERT INTO job_deps VALUES (?,?)');
  for (const d of dag.deps) insDep.run(d.job_name, d.depends_on);

  // 3. 跑批日志（真实环境：日志平台检索）
  const insLog = db.prepare('INSERT INTO batch_logs VALUES (?,?,?,?,?,?,?)');
  const allLogs = [];
  for (const f of fs.readdirSync(path.join(RAW_DIR, 'logs')).filter(f => f.endsWith('.log'))) {
    const runDate = f.slice(0, 10).replace(/-/g, '');
    const lines = fs.readFileSync(path.join(RAW_DIR, 'logs', f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const rec = parseLogLine(line, runDate, i + 1);
      if (rec) { insLog.run(rec.run_date, rec.ts, rec.job_name, rec.level, rec.message, rec.error_code, rec.line_no); allLogs.push(rec); }
    });
  }
  const insRun = db.prepare('INSERT INTO job_runs VALUES (?,?,?,?)');
  for (const r of aggregateJobRuns(allLogs)) insRun.run(r.run_date, r.job_name, r.final_status, r.rows_loaded);

  // 4. 错误码字典与历史工单（真实环境：工单系统 API）
  const raw = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'tickets.json'), 'utf8'));
  const insErr = db.prepare('INSERT INTO error_codes VALUES (?,?,?)');
  for (const e of raw.error_codes) insErr.run(e.code, e.meaning, e.typical_cause);
  const insTkt = db.prepare('INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?)');
  for (const t of raw.tickets) insTkt.run(t.ticket_id, t.title, t.symptom, t.root_cause, t.solution,
    JSON.stringify(t.related_jobs), JSON.stringify(t.related_tables), t.error_code || '');
}

module.exports = { collect, parseDdl };
