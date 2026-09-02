/**
 * 血缘解析：从存储过程 SQL 中提取 src→tgt 表级血缘（规则解析）
 * 真实环境建议：规则解析(sqlglot类)为主 + LLM 解析动态SQL兜底 + 抽样人工校验
 */
const fs = require('fs');
const path = require('path');
const { RAW_DIR } = require('../config');

const PARAM_RE = /^p_[a-z_]+$/i;

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** 提取存储过程的表级血缘 */
function parseProcedure(sql, procName) {
  const s = stripComments(sql);
  const edges = [];
  const insertRe = /insert\s+into\s+([a-zA-Z_][\w]*)([\s\S]*?)\bselect\b([\s\S]*?)(?=;|insert\s+into|update\s|delete\s|end\s*$)/gi;
  let m;
  while ((m = insertRe.exec(s))) {
    const tgt = m[1].toLowerCase();
    const body = m[3];
    const srcs = new Set();
    const fromRe = /\b(?:from|join)\s+([a-zA-Z_][\w]*)/gi;
    let fm;
    while ((fm = fromRe.exec(body))) {
      const t = fm[1].toLowerCase();
      if (PARAM_RE.test(t)) continue;
      if (t === 'select' || t === 'on') continue;
      srcs.add(t);
    }
    for (const src of srcs) edges.push({ proc_name: procName, src_table: src, tgt_table: tgt });
  }
  return edges;
}

/** 解析 data/raw/stored_procedures 下所有存储过程 */
function parseAllProcedures(db) {
  db.exec('DELETE FROM proc_lineage; DELETE FROM table_lineage;');
  const dir = path.join(RAW_DIR, 'stored_procedures');
  const insEdge = db.prepare('INSERT INTO proc_lineage VALUES (?,?,?)');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const nameM = /CREATE\s+PROCEDURE\s+([a-zA-Z_][\w]*)/i.exec(sql);
    const procName = nameM ? nameM[1].toLowerCase() : f.replace(/\.sql$/i, '');
    for (const e of parseProcedure(sql, procName)) insEdge.run(e.proc_name, e.src_table, e.tgt_table);
  }
  // 图融合：proc 血缘 × 调度 DAG → 表级血缘（附产出作业）
  db.exec(`INSERT INTO table_lineage
           SELECT pl.src_table, pl.tgt_table, pl.proc_name, j.job_name
           FROM proc_lineage pl LEFT JOIN jobs j ON j.proc_name = pl.proc_name
           GROUP BY pl.src_table, pl.tgt_table, pl.proc_name, j.job_name`);
}

module.exports = { parseAllProcedures, parseProcedure };
