import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Knex } from 'knex';
import { KNEX } from '../infra/database/database.module';
import { collectAll } from './collect';
import { AppConfig } from '../config/configuration';
import { GraphQueryService } from '../agent/graph-query.service';

/**
 * 采集服务：从数据源刷新知识库（原型读 data/raw 模拟源；生产替换为元数据/调度/日志/工单 API）。
 * 刷新后同步重载图查询服务的内存态，保证排查即时可用。
 */
@Injectable()
export class CollectorService {
  private readonly rawDir: string;

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    cfg: ConfigService,
    private readonly graph: GraphQueryService,
  ) {
    this.rawDir = cfg.get<AppConfig>('app')!.rawDir;
  }

  async refresh(): Promise<Record<string, number>> {
    const stats = await collectAll(this.db, this.rawDir);
    await this.graph.load();
    return stats;
  }
}