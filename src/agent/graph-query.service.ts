import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../infra/database/database.module';

export interface TableMetaRow {
  name: string;
  layer: string | null;
  comment: string | null;
  system_code: string;
}
export interface ColumnMetaRow {
  table_name: string;
  column_name: string;
  data_type: string | null;
  nullable: string | null;
  comment: string | null;
}
export interface JobRow {
  job_name: string;
  job_desc: string | null;
  proc_name: string | null;
  layer: string | null;
  schedule: string | null;
  system_code: string;
}
export interface DepRow {
  job_name: string;
  depends_on: string;
}
export interface LineageRow {
  src_table: string;
  tgt_table: string;
  proc_name: string | null;
  via_job: string | null;
}
export interface Hop {
  node: string;
  depth: number;
}

/**
 * 知识/存储层查询服务：血缘图谱 + 作业链路的多跳关系遍历。
 * 企业级实现：多跳遍历由 PostgreSQL 递归 CTE 承担（替代原型的内存 BFS），
 * 元数据/血缘/作业数组仍加载进内存供归因规则筛选（数据量小，数千表规模无压力）。
 */
@Injectable()
export class GraphQueryService implements OnModuleInit {
  tables: TableMetaRow[] = [];
  columns: ColumnMetaRow[] = [];
  jobs: JobRow[] = [];
  deps: DepRow[] = [];
  lineage: LineageRow[] = [];
  private producerOf = new Map<string, Set<string>>();
  private consumerOf = new Map<string, Set<string>>();

  constructor(@Inject(KNEX) private readonly db: Knex) {}

  async onModuleInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.tables = await this.db('meta_tables').select('name', 'layer', 'comment', 'system_code');
    this.columns = await this.db('meta_columns').select('table_name', 'column_name', 'data_type', 'nullable', 'comment');
    this.jobs = await this.db('jobs').select('job_name', 'job_desc', 'proc_name', 'layer', 'schedule', 'system_code');
    this.deps = await this.db('job_deps').select('job_name', 'depends_on');
    this.lineage = await this.db('table_lineage').select('src_table', 'tgt_table', 'proc_name', 'via_job');

    this.producerOf = new Map();
    this.consumerOf = new Map();
    for (const e of this.lineage) {
      if (e.via_job) {
        if (!this.producerOf.has(e.tgt_table)) this.producerOf.set(e.tgt_table, new Set());
        if (!this.consumerOf.has(e.src_table)) this.consumerOf.set(e.src_table, new Set());
        this.producerOf.get(e.tgt_table)!.add(e.via_job);
        this.consumerOf.get(e.src_table)!.add(e.via_job);
      }
    }
  }

  producersOf(table: string): string[] {
    return [...(this.producerOf.get(table) || [])];
  }

  consumersOf(table: string): string[] {
    return [...(this.consumerOf.get(table) || [])];
  }

  /** 目标作业及其产出表（含血缘上相关联的表） */
  tablesOfJobs(jobs: string[]): string[] {
    const set = new Set<string>();
    for (const e of this.lineage) {
      if (e.via_job && jobs.includes(e.via_job)) {
        set.add(e.tgt_table);
        set.add(e.src_table);
      }
    }
    return [...set];
  }

  /** 作业 N 级上游（递归 CTE）：依赖它的作业 → 它依赖的作业 */
  async jobUpstream(job: string, maxDepth = 4): Promise<Hop[]> {
    const rows = await this.db.raw(
      `WITH RECURSIVE up AS (
         SELECT :job AS node, 0 AS depth
         UNION ALL
         SELECT d.depends_on, up.depth + 1
         FROM up JOIN job_deps d ON d.job_name = up.node
         WHERE up.depth < :maxDepth
       )
       SELECT node, MIN(depth) AS depth FROM up WHERE depth > 0 GROUP BY node`,
      { job, maxDepth },
    );
    return rows.rows as Hop[];
  }

  /** 作业 N 级下游（递归 CTE）：依赖它的下游作业 */
  async jobDownstream(job: string, maxDepth = 4): Promise<Hop[]> {
    const rows = await this.db.raw(
      `WITH RECURSIVE down AS (
         SELECT :job AS node, 0 AS depth
         UNION ALL
         SELECT d.job_name, down.depth + 1
         FROM down JOIN job_deps d ON d.depends_on = down.node
         WHERE down.depth < :maxDepth
       )
       SELECT node, MIN(depth) AS depth FROM down WHERE depth > 0 GROUP BY node`,
      { job, maxDepth },
    );
    return rows.rows as Hop[];
  }

  /** 表 N 级上游（递归 CTE）：沿表级血缘向上 */
  async tableUpstream(table: string, maxDepth = 4): Promise<Hop[]> {
    const rows = await this.db.raw(
      `WITH RECURSIVE up AS (
         SELECT :table AS node, 0 AS depth
         UNION ALL
         SELECT l.src_table, up.depth + 1
         FROM up JOIN table_lineage l ON l.tgt_table = up.node
         WHERE up.depth < :maxDepth
       )
       SELECT node, MIN(depth) AS depth FROM up WHERE depth > 0 AND node <> :table GROUP BY node`,
      { table, maxDepth },
    );
    return rows.rows as Hop[];
  }

  /** 表 N 级下游（递归 CTE）：沿表级血缘向下 */
  async tableDownstream(table: string, maxDepth = 4): Promise<Hop[]> {
    const rows = await this.db.raw(
      `WITH RECURSIVE down AS (
         SELECT :table AS node, 0 AS depth
         UNION ALL
         SELECT l.tgt_table, down.depth + 1
         FROM down JOIN table_lineage l ON l.src_table = down.node
         WHERE down.depth < :maxDepth
       )
       SELECT node, MIN(depth) AS depth FROM down WHERE depth > 0 AND node <> :table GROUP BY node`,
      { table, maxDepth },
    );
    return rows.rows as Hop[];
  }
}