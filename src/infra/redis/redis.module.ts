import { Global, Module } from '@nestjs/common';
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
      useFactory: (cfg: ConfigService): Redis =>
        new Redis({
          host: cfg.get<AppConfig>('app')!.redis.host,
          port: cfg.get<AppConfig>('app')!.redis.port,
          lazyConnect: true,
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
        }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}

export const redisUrl = (cfg: AppConfig) => `redis://${cfg.redis.host}:${cfg.redis.port}`;