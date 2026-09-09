import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): Redis => {
        const client = new Redis({
          host: cfg.get<AppConfig>('app')!.redis.host,
          port: cfg.get<AppConfig>('app')!.redis.port,
          // 急切连接 + 指数退避重连：避免 lazyConnect 下首个命令抢跑连接导致
          // "Stream isn't writeable"（logs/pm2-error 中曾反复出现）
          retryStrategy: (times) => Math.min(times * 500, 5_000),
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
        });
        // 必须挂 error 监听：连接失败/断线时避免 unhandled 'error' 崩溃进程
        client.on('error', (e) => new Logger('Redis').warn(`Redis 连接异常（将自动重连）：${e.message}`));
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}

export const redisUrl = (cfg: AppConfig) => `redis://${cfg.redis.host}:${cfg.redis.port}`;