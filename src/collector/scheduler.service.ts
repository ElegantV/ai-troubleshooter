import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { AppConfig } from '../config/configuration';
import { CollectorService } from './collector.service';

const COLLECT_QUEUE = 'knowledge-collect';

/**
 * 定时采集调度（BullMQ + Redis）：
 * 每 collectionIntervalMinutes（默认 10）分钟执行一次知识库刷新，启动时先执行一次。
 * Redis 不可用时降级为启动一次性刷新（手动触发走 POST /admin/collect）。
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly cfg: ConfigService,
    private readonly collector: CollectorService,
  ) {}

  async onModuleInit(): Promise<void> {
    const app = this.cfg.get<AppConfig>('app')!;
    const connection = { host: app.redis.host, port: app.redis.port };

    // 启动即刷新一次（保证最新知识库）
    try {
      const stats = await this.collector.refresh();
      this.logger.log(`启动采集完成: ${JSON.stringify(stats)}`);
    } catch (e) {
      this.logger.warn(`启动采集失败（数据源不可用？）: ${(e as Error).message}`);
    }

    try {
      this.queue = new Queue(COLLECT_QUEUE, { connection });
      this.worker = new Worker(
        COLLECT_QUEUE,
        async (job) => {
          this.logger.log(`定时采集触发 (job ${job.id})`);
          await this.collector.refresh();
        },
        { connection },
      );
      await this.queue.upsertJobScheduler('collect-schedule', { every: app.collectionIntervalMinutes * 60_000 }, { name: 'collect' });
      this.logger.log(`定时采集已注册：每 ${app.collectionIntervalMinutes} 分钟`);
    } catch (e) {
      this.logger.warn(`Redis/BullMQ 不可用，定时采集降级：${(e as Error).message}`);
      this.queue = null;
      this.worker = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}