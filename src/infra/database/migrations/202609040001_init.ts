import { Knex } from 'knex';

/** v1 初始结构：知识表 + 业务表 + 认证表（users.role 支持 RBAC） */
export async function up(knex: Knex): Promise<void> {
  // ---- 知识/存储层 ----
  await knex.schema.createTable('meta_tables', (t) => {
    t.text('name').primary();
    t.text('layer');
    t.text('comment');
  });
  await knex.schema.createTable('meta_columns', (t) => {
    t.text('table_name');
    t.text('column_name');
    t.text('data_type');
    t.text('nullable');
    t.text('comment');
    t.primary(['table_name', 'column_name']);
  });
  await knex.schema.createTable('jobs', (t) => {
    t.text('job_name').primary();
    t.text('job_desc');
    t.text('proc_name');
    t.text('layer');
    t.text('schedule');
  });
  await knex.schema.createTable('job_deps', (t) => {
    t.increments('id');
    t.text('job_name');
    t.text('depends_on');
  });
  await knex.schema.createTable('proc_lineage', (t) => {
    t.increments('id');
    t.text('proc_name');
    t.text('src_table');
    t.text('tgt_table');
  });
  await knex.schema.createTable('table_lineage', (t) => {
    t.increments('id');
    t.text('src_table');
    t.text('tgt_table');
    t.text('proc_name');
    t.text('via_job');
  });
  await knex.schema.createTable('batch_logs', (t) => {
    t.increments('id');
    t.text('run_date');
    t.text('ts');
    t.text('job_name');
    t.text('level');
    t.text('message');
    t.text('error_code');
    t.integer('line_no');
    t.index(['run_date', 'job_name']);
  });
  await knex.schema.createTable('job_runs', (t) => {
    t.text('run_date');
    t.text('job_name');
    t.text('final_status');
    t.bigInteger('rows_loaded');
    t.primary(['run_date', 'job_name']);
  });
  await knex.schema.createTable('error_codes', (t) => {
    t.text('code').primary();
    t.text('meaning');
    t.text('typical_cause');
  });
  await knex.schema.createTable('tickets', (t) => {
    t.text('ticket_id').primary();
    t.text('title');
    t.text('symptom');
    t.text('root_cause');
    t.text('solution');
    t.text('related_jobs');
    t.text('related_tables');
    t.text('error_code');
  });

  // ---- 业务层：案例（含操作归属 created_by）----
  await knex.schema.createTable('cases', (t) => {
    t.text('case_id').primary();
    t.text('symptom');
    t.text('root_cause');
    t.text('solution');
    t.text('related_jobs');
    t.text('related_tables');
    t.text('error_code');
    t.text('source');
    t.text('created_at');
    t.text('created_by');
  });

  // ---- 审计层 ----
  await knex.schema.createTable('query_log', (t) => {
    t.text('query_id').primary();
    t.text('created_at');
    t.text('input_text');
    t.text('entities_json');
    t.text('report_json');
    t.text('helpful');
    t.text('confirmed_cause');
    t.text('feedback_at');
    t.text('user_name');
  });

  // ---- 认证层（JWT + RBAC）----
  await knex.schema.createTable('users', (t) => {
    t.text('username').primary();
    t.text('display_name');
    t.text('password_hash');
    t.text('salt');
    t.text('role').notNullable().defaultTo('user');
    t.text('created_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    'users', 'query_log', 'cases', 'tickets', 'error_codes', 'job_runs', 'batch_logs',
    'table_lineage', 'proc_lineage', 'job_deps', 'jobs', 'meta_columns', 'meta_tables',
  ];
  for (const t of tables) await knex.schema.dropTableIfExists(t);
}