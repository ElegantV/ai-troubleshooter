import * as path from 'path';
import { DatabaseModule } from './database.module';
import configuration from '../../config/configuration';

/** CLI：npm run migrate —— 应用全部版本化迁移（幂等） */
async function main() {
  const { app } = configuration();
  const db = DatabaseModule.buildKnex(app.db, 0, 2);
  try {
    const migrationsDir = path.join(__dirname, 'migrations');
    const res = await db.migrate.latest({ directory: migrationsDir });
    const applied = Array.isArray(res) ? res[1] : res;
    console.log(`迁移完成（${migrationsDir}）：`, applied.join(', ') || '无新迁移');
  } finally {
    await db.destroy();
  }
}

main().catch((e) => {
  console.error('迁移失败：', e);
  process.exit(1);
});