import { Knex } from 'knex';

/** v2 系统隔离：systems 字典 + 表/作业/用户/工单/案例 关联 system_code（'' = 共享/公共） */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('systems', (t) => {
    t.text('code').primary();
    t.text('name');
    t.text('description');
  });
  await knex.schema.alterTable('meta_tables', (t) => t.text('system_code').defaultTo(''));
  await knex.schema.alterTable('jobs', (t) => t.text('system_code').defaultTo(''));
  await knex.schema.alterTable('users', (t) => t.text('system_code').defaultTo(''));
  await knex.schema.alterTable('tickets', (t) => t.text('system_code').defaultTo(''));
  await knex.schema.alterTable('cases', (t) => t.text('system_code').defaultTo(''));
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cases', (t) => t.dropColumn('system_code'));
  await knex.schema.alterTable('tickets', (t) => t.dropColumn('system_code'));
  await knex.schema.alterTable('users', (t) => t.dropColumn('system_code'));
  await knex.schema.alterTable('jobs', (t) => t.dropColumn('system_code'));
  await knex.schema.alterTable('meta_tables', (t) => t.dropColumn('system_code'));
  await knex.schema.dropTableIfExists('systems');
}