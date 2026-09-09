import { DatabaseSync } from 'node:sqlite';
import { DatabaseModule } from '../infra/database/database.module';
import configuration from '../config/configuration';
import { caseDedupeKey } from '../case/case.service';

/**
 * 一次性迁移：SQLite(data/assistant.db) → PostgreSQL
 * 仅迁移「数据飞轮」数据：users / cases / query_log（审计）。知识表由 seed 重建。
 */
async function main() {
  const { app } = configuration();
  const src = new DatabaseSync('data/assistant.db');
  const db = DatabaseModule.buildKnex(app.db, 0, 2);
  try {
    const copy = async (table: string, cols: string[]) => {
      const rows = src.prepare(`SELECT ${cols.join(',')} FROM ${table}`).all() as any[];
      if (!rows.length) { console.log(`${table}: 无数据`); return; }
      const inserts = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
      // cases 需要回填去重键，否则无法满足 ux_cases_dedupe_key 唯一约束
      if (table === 'cases') {
        for (const r of inserts) r.dedupe_key = caseDedupeKey(String(r.symptom || ''), String(r.root_cause || ''));
      }
      await db(table).insert(inserts);
      console.log(`${table}: 迁移 ${rows.length} 条`);
    };
    await copy('users', ['username', 'display_name', 'password_hash', 'salt', 'created_at']);
    await copy('cases', ['case_id', 'symptom', 'root_cause', 'solution', 'related_jobs', 'related_tables', 'error_code', 'source', 'created_at', 'created_by']);
    await copy('query_log', ['query_id', 'created_at', 'input_text', 'entities_json', 'report_json', 'helpful', 'confirmed_cause', 'feedback_at', 'user_name']);
    console.log('迁移完成：users/cases/query_log 已并入 PostgreSQL');
  } finally {
    src.close();
    await db.destroy();
  }
}

main().catch((e) => {
  console.error('迁移失败：', e);
  process.exit(1);
});