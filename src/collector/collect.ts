import { Knex } from 'knex';
import * as fs from 'fs';
import * as path from 'path';
import { parseDdl } from './parse-ddl';
import { parseAllProcedures } from './parse-lineage';

export interface LogRecord {
  run_date: string;
  ts: string;
  job_name: string;
  level: string;
  message: string;
  error_code: string;
  line_no: number;
}

/** 解析跑批日志行：[ts] LEVEL job message */
export function parseLogLine(line: string, runDate: string, lineNo: number): LogRecord | null {
  const m = /^\[([\d\- :]+)\]\s+(INFO|WARN|ERROR)\s+([a-zA-Z_][\w]*)\s+(.*)$/.exec(line.trim());
  if (!m) return null;
  const message = m[4];
  const oraM = /ORA-\d{5}/.exec(message);
  const error_code = oraM ? oraM[0] : /SKIPPED/.test(message) ? 'SKIPPED' : '';
  return { run_date: runDate, ts: m[1].trim(), job_name: m[3], level: m[2], message, error_code, line_no: lineNo };
}

/** 从日志聚合每个作业当日最终状态与加载行数 */
export function aggregateJobRuns(logs: LogRecord[]): Array<{ run_date: string; job_name: string; final_status: string; rows_loaded: number | null }> {
  const runs = new Map<string, { run_date: string; job_name: string; final_status: string; rows_loaded: number | null }>();
  for (const l of logs) {
    const key = `${l.run_date}|${l.job_name}`;
    if (!runs.has(key)) runs.set(key, { run_date: l.run_date, job_name: l.job_name, final_status: 'RUNNING', rows_loaded: null });
    const r = runs.get(key)!;
    if (/SKIPPED/.test(l.message)) r.final_status = 'SKIPPED';
    if (/FAILED/.test(l.message) && l.level === 'ERROR') r.final_status = 'FAILED';
    if (/SUCCESS/.test(l.message)) r.final_status = 'SUCCESS';
    const rm = /rows_loaded=(\d+)/.exec(l.message);
    if (rm) r.rows_loaded = parseInt(rm[1], 10);
  }
  return [...runs.values()];
}

/**
 * 知识库全量刷新（数据采集层：原型读 data/raw 模拟源；生产替换为元数据/调度/日志/工单 API）。
 * 仅刷新知识表；cases / query_log / users（数据飞轮 + 认证）全部保留。
 */
export async function collectAll(db: Knex, rawDir: string): Promise<Record<string, number>> {
  await db('meta_tables').del();
  await db('meta_columns').del();
  await db('jobs').del();
  await db('job_deps').del();
  await db('batch_logs').del();
  await db('job_runs').del();
  await db('error_codes').del();
  await db('tickets').del();
  await db('systems').del();

  // 1. 表结构元数据（真实环境：元数据平台接口）
  const ddl = fs.readFileSync(path.join(rawDir, 'ddl.sql'), 'utf8');
  for (const t of parseDdl(ddl)) {
    await db('meta_tables').insert({ name: t.name, layer: t.name.split('_')[0].toUpperCase(), comment: t.comment });
    if (t.cols.length) {
      await db('meta_columns').insert(t.cols.map((c) => ({ table_name: t.name, ...c })));
    }
  }

  // 2. 调度依赖（真实环境：调度系统 API 导出 DAG）
  const dag = JSON.parse(fs.readFileSync(path.join(rawDir, 'dag.json'), 'utf8'));
  if (dag.jobs?.length) {
    await db('jobs').insert(dag.jobs.map((j: any) => ({ job_name: j.job_name, job_desc: j.job_desc, proc_name: j.proc_name, layer: j.layer, schedule: j.schedule })));
  }
  if (dag.deps?.length) {
    await db('job_deps').insert(dag.deps.map((d: any) => ({ job_name: d.job_name, depends_on: d.depends_on })));
  }

  // 3. 跑批日志（真实环境：日志平台检索，按 run_date 增量）
  const logsDir = path.join(rawDir, 'logs');
  if (!fs.existsSync(logsDir)) {
    throw new Error(`缺少跑批日志目录 ${logsDir}：请确认 data/raw/logs/*.log 演示数据已就位`);
  }
  const allLogs: LogRecord[] = [];
  for (const f of fs.readdirSync(logsDir).filter((f) => f.endsWith('.log'))) {
    const runDate = f.slice(0, 10).replace(/-/g, '');
    const lines = fs.readFileSync(path.join(rawDir, 'logs', f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const rec = parseLogLine(line, runDate, i + 1);
      if (rec) allLogs.push(rec);
    });
  }
  if (allLogs.length) await db('batch_logs').insert(allLogs);
  const runs = aggregateJobRuns(allLogs);
  if (runs.length) await db('job_runs').insert(runs);

  // 4. 系统字典与归属（真实环境：系统登记/资产目录 API）；'' 表示共享/公共
  const sysPath = path.join(rawDir, 'systems.json');
  const jobSys: Record<string, string> = {};
  const tableSys: Record<string, string> = {};
  if (fs.existsSync(sysPath)) {
    const sysRaw = JSON.parse(fs.readFileSync(sysPath, 'utf8'));
    if (sysRaw.systems?.length) {
      await db('systems').insert(sysRaw.systems.map((s: any) => ({ code: s.code, name: s.name, description: s.description })));
      for (const s of sysRaw.systems) {
        for (const j of s.jobs || []) jobSys[j] = s.code;
        for (const t of s.tables || []) tableSys[t] = s.code;
      }
    }
  }
  for (const [name, code] of Object.entries(tableSys)) {
    await db('meta_tables').where({ name }).update({ system_code: code });
  }
  for (const [jobName, code] of Object.entries(jobSys)) {
    await db('jobs').where({ job_name: jobName }).update({ system_code: code });
  }

  // 5. 错误码字典与历史工单（真实环境：工单系统 API）；工单归属由关联作业/表推导
  const raw = JSON.parse(fs.readFileSync(path.join(rawDir, 'tickets.json'), 'utf8'));
  if (raw.error_codes?.length) await db('error_codes').insert(raw.error_codes);
  if (raw.tickets?.length) {
    await db('tickets').insert(raw.tickets.map((t: any) => {
      const jobs: string[] = JSON.parse(JSON.stringify(t.related_jobs || '[]'));
      const tables: string[] = JSON.parse(JSON.stringify(t.related_tables || '[]'));
      const sys = jobs.map((j) => jobSys[j]).find(Boolean) || tables.map((x) => tableSys[x]).find(Boolean) || '';
      return {
        ticket_id: t.ticket_id, title: t.title, symptom: t.symptom, root_cause: t.root_cause,
        solution: t.solution, related_jobs: JSON.stringify(t.related_jobs), related_tables: JSON.stringify(t.related_tables),
        error_code: t.error_code || '', system_code: sys,
      };
    }));
  }

  // 6. 存储过程血缘解析 + 图融合
  await parseAllProcedures(db, rawDir);

  const stats: Record<string, number> = {};
  for (const t of ['meta_tables', 'meta_columns', 'jobs', 'job_deps', 'proc_lineage', 'table_lineage', 'batch_logs', 'job_runs', 'error_codes', 'tickets']) {
    stats[t] = Number((await db(t).count<{ c: string }>('* as c').first())?.c || 0);
  }
  return stats;
}