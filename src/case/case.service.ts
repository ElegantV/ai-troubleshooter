import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import * as crypto from 'crypto';
import { KNEX } from '../infra/database/database.module';
import { GraphQueryService } from '../agent/graph-query.service';

/** 案例去重键：规范化 symptom+root_cause 后 md5，与迁移 v3 的唯一索引算法保持一致 */
export function caseDedupeKey(symptom: string, rootCause: string): string {
  const norm = (s: string) => s.trim().toLowerCase();
  return crypto.createHash('md5').update(`${norm(symptom)}|${norm(rootCause)}`).digest('hex');
}

export interface CaseRow {
  case_id: string;
  symptom: string;
  root_cause: string;
  solution: string;
  related_jobs: string[];
  related_tables: string[];
  error_code: string;
  source: string;
  created_at: string;
  created_by: string;
  system_code: string;
}

@Injectable()
export class CaseService {
  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly graph: GraphQueryService,
  ) {}

  async list(limit = 100, offset = 0): Promise<{ items: CaseRow[]; total: number; limit: number; offset: number }> {
    const [rows, totalRow] = await Promise.all([
      this.db('cases').select('*').orderBy('created_at', 'desc').limit(limit).offset(offset),
      this.db('cases').count<{ c: string }>('* as c').first(),
    ]);
    const items = rows.map((c) => ({
      case_id: c.case_id,
      symptom: c.symptom,
      root_cause: c.root_cause,
      solution: c.solution,
      related_jobs: JSON.parse(c.related_jobs || '[]'),
      related_tables: JSON.parse(c.related_tables || '[]'),
      error_code: c.error_code || '',
      source: c.source,
      created_at: c.created_at,
      created_by: c.created_by || '',
      system_code: c.system_code || '',
    }));
    return { items, total: Number(totalRow?.c || 0), limit, offset };
  }

  async create(
    input: { title?: string; symptom?: string; root_cause?: string; solution?: string; related_jobs?: string; related_tables?: string; error_code?: string },
    user: { username: string; system_code?: string },
  ): Promise<{ ok: boolean; caseId?: string; auto_detected: Record<string, unknown> }> {
    const title = String(input.title || '').trim();
    const symptom = String(input.symptom || '').trim();
    const root_cause = String(input.root_cause || '').trim();
    const solution = String(input.solution || '').trim();

    const dedupeKey = caseDedupeKey(symptom, root_cause);

    // 自动识别关联作业/表/错误码（用户填写的优先，识别到的补充）
    const blob = `${title} ${symptom} ${root_cause}`;
    const blobLow = blob.toLowerCase();
    const jobDescByName = new Map(this.graph.jobs.map((j) => [j.job_name, j.job_desc || '']));
    const autoJobs = this.graph.jobs.map((j) => j.job_name).filter((j) => blobLow.includes(j.toLowerCase()) || (jobDescByName.get(j) && blob.includes(jobDescByName.get(j)!)));
    const autoTables = this.graph.tables.map((t) => t.name).filter((t) => blobLow.includes(t));
    const codes = await this.db('error_codes').select('code');
    const autoCode = codes.map((r) => r.code).find((c) => blob.includes(c)) || /ORA-\d{5}/.exec(blob)?.[0] || '';

    const splitList = (s: string) => String(s || '').split(/[,，;；、\s]+/).map((x) => x.trim()).filter(Boolean);
    const jobs = [...new Set([...splitList(input.related_jobs || ''), ...autoJobs])];
    const tables = [...new Set([...splitList(input.related_tables || ''), ...autoTables])];
    const errorCode = String(input.error_code || '').trim().toUpperCase() || autoCode;

    const caseId = 'CASE-' + Date.now();
    // 事务 + DB 唯一约束（ux_cases_dedupe_key）双保险：查重在事务内完成，并发写入由约束兜底
    try {
      await this.db.transaction(async (trx) => {
        const dup = await trx('cases').where({ dedupe_key: dedupeKey }).first();
        if (dup) {
          throw Object.assign(new Error(`知识库中已存在相同现象的案例（${dup.case_id}），无需重复录入`), { status: 409 });
        }
        await trx('cases').insert({
          case_id: caseId,
          symptom,
          root_cause,
          solution,
          related_jobs: JSON.stringify(jobs),
          related_tables: JSON.stringify(tables),
          error_code: errorCode,
          source: '人工录入',
          created_at: new Date().toISOString(),
          created_by: user.username,
          system_code: user.system_code || '',
          dedupe_key: dedupeKey,
        });
      });
    } catch (e) {
      // 并发竞争触发的唯一约束冲突（23505）→ 转成同样的友好提示
      if (isUniqueViolation(e)) {
        throw Object.assign(new Error('知识库中已存在相同现象与原因的案例，无需重复录入'), { status: 409 });
      }
      throw e;
    }
    return { ok: true, caseId, auto_detected: { jobs: autoJobs, tables: autoTables, error_code: autoCode || null } };
  }

  async remove(caseId: string): Promise<void> {
    await this.db('cases').where({ case_id: caseId }).del();
  }
}

/** PostgreSQL 唯一约束冲突（SQLSTATE 23505） */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}