import { Knex } from 'knex';

/**
 * v4：查询路径索引。
 * 背景：血缘遍历、上游链路回溯、审计列表、按系统收敛检索是高频查询，
 * 此前除 batch_logs(run_date, job_name) 外均无索引，数据规模上来后全表扫描。
 */
export async function up(knex: Knex): Promise<void> {
  // 调度依赖：job_deps 双向遍历（找上游 depends_on / 找下游 job_name）
  await knex.schema.alterTable('job_deps', (t) => {
    t.index(['job_name']);
    t.index(['depends_on']);
  });
  // 血缘：proc 血缘与表级血缘的源/目标/过程查询
  await knex.schema.alterTable('proc_lineage', (t) => {
    t.index(['proc_name']);
    t.index(['src_table']);
    t.index(['tgt_table']);
  });
  await knex.schema.alterTable('table_lineage', (t) => {
    t.index(['src_table']);
    t.index(['tgt_table']);
    t.index(['proc_name']);
  });
  // 日志：错误码归因
  await knex.schema.alterTable('batch_logs', (t) => {
    t.index(['error_code']);
  });
  // 审计：排查历史分页（created_at 排序）+ 按人检索
  await knex.schema.alterTable('query_log', (t) => {
    t.index(['created_at']);
    t.index(['user_name']);
  });
  // 案例列表：created_at 倒序分页
  await knex.schema.alterTable('cases', (t) => {
    t.index(['created_at']);
  });
  // 检索收敛：错误码 / 系统归属
  await knex.schema.alterTable('tickets', (t) => {
    t.index(['error_code']);
    t.index(['system_code']);
  });
  await knex.schema.alterTable('meta_tables', (t) => {
    t.index(['system_code']);
  });
  await knex.schema.alterTable('jobs', (t) => {
    t.index(['system_code']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('job_deps', (t) => {
    t.dropIndex(['job_name']);
    t.dropIndex(['depends_on']);
  });
  await knex.schema.alterTable('proc_lineage', (t) => {
    t.dropIndex(['proc_name']);
    t.dropIndex(['src_table']);
    t.dropIndex(['tgt_table']);
  });
  await knex.schema.alterTable('table_lineage', (t) => {
    t.dropIndex(['src_table']);
    t.dropIndex(['tgt_table']);
    t.dropIndex(['proc_name']);
  });
  await knex.schema.alterTable('batch_logs', (t) => {
    t.dropIndex(['error_code']);
  });
  await knex.schema.alterTable('query_log', (t) => {
    t.dropIndex(['created_at']);
    t.dropIndex(['user_name']);
  });
  await knex.schema.alterTable('cases', (t) => {
    t.dropIndex(['created_at']);
  });
  await knex.schema.alterTable('tickets', (t) => {
    t.dropIndex(['error_code']);
    t.dropIndex(['system_code']);
  });
  await knex.schema.alterTable('meta_tables', (t) => {
    t.dropIndex(['system_code']);
  });
  await knex.schema.alterTable('jobs', (t) => {
    t.dropIndex(['system_code']);
  });
}