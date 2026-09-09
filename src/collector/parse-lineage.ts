import { Knex } from 'knex';
import * as fs from 'fs';
import * as path from 'path';

const PARAM_RE = /^p_[a-z_]+$/i;

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

export interface LineageEdge {
  proc_name: string;
  src_table: string;
  tgt_table: string;
}

/** 提取存储过程的表级血缘（规则解析；真实环境叠加 sqlglot + LLM 兜底） */
export function parseProcedure(sql: string, procName: string): LineageEdge[] {
  const s = stripComments(sql);
  const edges: LineageEdge[] = [];
  const insertRe = /insert\s+into\s+([a-zA-Z_][\w]*)([\s\S]*?)\bselect\b([\s\S]*?)(?=;|insert\s+into|update\s|delete\s|end\s*$)/gi;
  let m: RegExpExecArray | null;
  while ((m = insertRe.exec(s))) {
    const tgt = m[1].toLowerCase();
    const body = m[3];
    const srcs = new Set<string>();
    const fromRe = /\b(?:from|join)\s+([a-zA-Z_][\w]*)/gi;
    let fm: RegExpExecArray | null;
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

/**
 * 解析 data/raw/stored_procedures 下所有存储过程，并做图融合 → 表级血缘（附产出作业）。
 * 由 collectAll 在事务内调用：proc_lineage / table_lineage 的清空由事务统一处理，失败整体回滚。
 */
export async function parseAllProcedures(db: Knex, rawDir: string): Promise<void> {
  const dir = path.join(rawDir, 'stored_procedures');
  const edges: LineageEdge[] = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const nameM = /CREATE\s+PROCEDURE\s+([a-zA-Z_][\w]*)/i.exec(sql);
    const procName = nameM ? nameM[1].toLowerCase() : f.replace(/\.sql$/i, '');
    edges.push(...parseProcedure(sql, procName));
  }
  if (edges.length) await db('proc_lineage').insert(edges);
  // 图融合：proc 血缘 × 调度 DAG → 表级血缘（附产出作业）
  const fused = await db('proc_lineage as pl')
    .select('pl.src_table', 'pl.tgt_table', 'pl.proc_name', 'j.job_name as via_job')
    .leftJoin('jobs as j', 'j.proc_name', 'pl.proc_name')
    .groupBy('pl.src_table', 'pl.tgt_table', 'pl.proc_name', 'j.job_name');
  if (fused.length) await db('table_lineage').insert(fused);
}