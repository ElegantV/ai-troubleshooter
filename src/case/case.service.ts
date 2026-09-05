import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../infra/database/database.module';
import { GraphQueryService } from '../agent/graph-query.service';

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

  async list(): Promise<CaseRow[]> {
    const rows = await this.db('cases').select('*').orderBy('created_at', 'desc');
    return rows.map((c) => ({
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
  }

  async create(
    input: { title?: string; symptom?: string; root_cause?: string; solution?: string; related_jobs?: string; related_tables?: string; error_code?: string },
    user: { username: string; system_code?: string },
  ): Promise<{ ok: boolean; caseId?: string; auto_detected: Record<string, unknown> }> {
    const title = String(input.title || '').trim();
    const symptom = String(input.symptom || '').trim();
    const root_cause = String(input.root_cause || '').trim();
    const solution = String(input.solution || '').trim();

    const dup = await this.db('cases').where({ symptom }).orWhere((q) => q.where({ symptom }).andWhere({ root_cause })).first();
    if (dup) throw Object.assign(new Error(`知识库中已存在相同现象的案例（${dup.case_id}），无需重复录入`), { status: 409 });

    // 自动识别关联作业/表/错误码（用户填写的优先，识别到的补充）
    const blob = `${title} ${symptom} ${root_cause}`;
    const blobLow = blob.toLowerCase();
    const autoJobs = this.graph.jobs.map((j) => j.job_name).filter((j) => blobLow.includes(j.toLowerCase()) || (this.graph.jobs.find((x) => x.job_name === j)?.job_desc && blob.includes(this.graph.jobs.find((x) => x.job_name === j)!.job_desc!)));
    const autoTables = this.graph.tables.map((t) => t.name).filter((t) => blobLow.includes(t));
    const codes = await this.db('error_codes').select('code');
    const autoCode = codes.map((r) => r.code).find((c) => blob.includes(c)) || /ORA-\d{5}/.exec(blob)?.[0] || '';

    const splitList = (s: string) => String(s || '').split(/[,，;；、\s]+/).map((x) => x.trim()).filter(Boolean);
    const jobs = [...new Set([...splitList(input.related_jobs || ''), ...autoJobs])];
    const tables = [...new Set([...splitList(input.related_tables || ''), ...autoTables])];
    const errorCode = String(input.error_code || '').trim().toUpperCase() || autoCode;

    const caseId = 'CASE-' + Date.now();
    await this.db('cases').insert({
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
    });
    return { ok: true, caseId, auto_detected: { jobs: autoJobs, tables: autoTables, error_code: autoCode || null } };
  }

  async remove(caseId: string): Promise<void> {
    await this.db('cases').where({ case_id: caseId }).del();
  }
}