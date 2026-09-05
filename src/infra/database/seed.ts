import { DatabaseModule } from './database.module';
import { collectAll } from '../../collector/collect';
import configuration from '../../config/configuration';

/** CLI：npm run seed —— 从 data/raw 刷新知识库（保留案例/审计/用户） */
async function main() {
  const { app } = configuration();
  const db = DatabaseModule.buildKnex(app.db, 0, 2);
  try {
    const stats = await collectAll(db, app.rawDir);
    console.log('知识库构建完成:', JSON.stringify(stats));
  } finally {
    await db.destroy();
  }
}

main().catch((e) => {
  console.error('构建失败：', e);
  process.exit(1);
});