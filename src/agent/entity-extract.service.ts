import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../infra/database/database.module';
import { GraphQueryService } from './graph-query.service';

export type RouteType = 'job_failure' | 'data_anomaly' | 'proc_analysis' | 'other';

export interface Entity {
  tables: string[];
  jobs: string[];
  columns: string[];
  date: string | null;
  errorCode: string;
  route: RouteType | null;
  raw: string;
}

const ANOMALY_KEYWORDS = ['异常', '骤降', '缺失', '为空', '偏少', '不对', '重复', ' NULL', 'null', '不一致', '波动'];
const FAIL_KEYWORDS = ['失败', '报错', 'error', 'skipped', '跳过', '未跑', '挂了'];

/** 输入理解：词典匹配场景路由（接入 LLM 后由 LLM 完成实体识别与现象归一化） */
@Injectable()
export class EntityExtractService {
  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly graph: GraphQueryService,
  ) {}

  async extract(text: string, systemCode = ''): Promise<Entity> {
    const t = String(text);
    const low = t.toLowerCase();
    const hit = (name: string) => low.includes(name.toLowerCase());

    // 所属系统收敛：只匹配本系统 + 共享('')的表/作业，缩小候选集提升路由精度与检索效率
    const inScope = (sys: string | undefined | null) => !systemCode || !sys || sys === systemCode;
    const tables = this.graph.tables.filter((x) => inScope(x.system_code) && hit(x.name)).map((x) => x.name);
    const jobs = this.graph.jobs
      .filter((x) => inScope(x.system_code) && (hit(x.job_name) || (x.job_desc && t.includes(x.job_desc))))
      .map((x) => x.job_name);
    const columns = [
      ...new Set(
        this.graph.columns.filter((c) => new RegExp(`\\b${c.column_name}\\b`, 'i').test(low)).map((c) => c.column_name),
      ),
    ];

    let date: string | null = null;
    const dm = /(20\d{2})[-/年]?(\d{1,2})[-/月]?(\d{1,2})/.exec(t);
    if (dm) date = `${dm[1]}${String(dm[2]).padStart(2, '0')}${String(dm[3]).padStart(2, '0')}`;
    if (!date && /(昨天|昨晚)/.test(t)) {
      date = (await this.latestRunDate()) || null;
    }
    const errorCodeM = /ORA-\d{5}/.exec(t);

    let route: RouteType | null = null;
    if (/insert\s+into[\s\S]{0,400}?select[\s\S]{0,2000}?\bfrom\b|create\s+procedure/i.test(t)) route = 'proc_analysis';
    else if (jobs.length || (FAIL_KEYWORDS.some((k) => low.includes(k)) && !tables.length)) route = 'job_failure';
    else if (tables.length || columns.length || ANOMALY_KEYWORDS.some((k) => low.includes(k))) route = 'data_anomaly';
    else if (FAIL_KEYWORDS.some((k) => low.includes(k))) route = 'job_failure';

    return { tables, jobs, columns, date, errorCode: errorCodeM ? errorCodeM[0] : '', route, raw: t };
  }

  async latestRunDate(): Promise<string | null> {
    const r = await this.db('job_runs').max<{ d: string | null }>('run_date as d').first();
    return r?.d ?? null;
  }
}