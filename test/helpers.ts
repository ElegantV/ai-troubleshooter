import { Knex } from 'knex';
import { DatabaseModule } from '../src/infra/database/database.module';
import configuration from '../src/config/configuration';
import { collectAll } from '../src/collector/collect';
import { GraphQueryService } from '../src/agent/graph-query.service';
import { up as initUp } from '../src/infra/database/migrations/202609040001_init';
import { up as sysUp } from '../src/infra/database/migrations/202609040002_systems';

export interface TestCtx {
  db: Knex;
  graph: GraphQueryService;
  rawDir: string;
}

/**
 * 建测试上下文：连接 assistant_test，重建全表（down→up）+ 用 data/raw 灌入知识库，加载图服务。
 * 迁移直接调用迁移函数（vitest ESM 下 knex 自带加载器无法 require TS 迁移文件）。
 */
export async function createTestCtx(): Promise<TestCtx> {
  const { app } = configuration();
  const db = DatabaseModule.buildKnex(app.db, 0, 5);
  // 测试库整库重建（干净、幂等），再按顺序应用全部迁移
  await db.raw('DROP SCHEMA public CASCADE');
  await db.raw('CREATE SCHEMA public');
  await initUp(db);
  await sysUp(db);
  await collectAll(db, app.rawDir);
  const graph = new GraphQueryService(db);
  await graph.load();
  return { db, graph, rawDir: app.rawDir };
}

export async function destroyCtx(ctx: TestCtx): Promise<void> {
  await ctx.db.destroy();
}