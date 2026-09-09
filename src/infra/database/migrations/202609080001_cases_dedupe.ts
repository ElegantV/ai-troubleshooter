import { Knex } from 'knex';

/**
 * v3：案例去重键 + 唯一约束。
 * 背景：case.service 之前是 select-then-insert，并发下可写入重复案例；
 * 反馈沉淀（workflow.saveFeedback）也无查重。引入 dedupe_key（symptom+root_cause 规范化后的 md5）
 * 作为 DB 层唯一约束兜底，业务层仍保留友好 409 提示。
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cases', (t) => {
    t.text('dedupe_key');
  });

  // 存量回填：规范化（trim + 小写）拼接，与业务层算法保持一致
  await knex.raw(`
    UPDATE cases
    SET dedupe_key = md5(lower(btrim(coalesce(symptom, ''))) || '|' || lower(btrim(coalesce(root_cause, ''))))
  `);

  // 存量重复数据：同一 dedupe_key 仅保留最早一条（created_at 为 ISO 文本，字典序即时间序）
  await knex.raw(`
    DELETE FROM cases a
    USING cases b
    WHERE a.dedupe_key = b.dedupe_key
      AND a.case_id <> b.case_id
      AND (a.created_at > b.created_at OR (a.created_at = b.created_at AND a.case_id > b.case_id))
  `);

  await knex.schema.alterTable('cases', (t) => {
    t.text('dedupe_key').notNullable().alter();
  });
  await knex.raw('CREATE UNIQUE INDEX ux_cases_dedupe_key ON cases (dedupe_key)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS ux_cases_dedupe_key');
  await knex.schema.alterTable('cases', (t) => {
    t.dropColumn('dedupe_key');
  });
}