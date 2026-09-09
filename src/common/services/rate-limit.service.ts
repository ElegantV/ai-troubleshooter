import { Inject, Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module';

/**
 * 通用 Redis 窗口限流（fail-open）：
 * 窗口内超出 limit 次即拒绝；Redis 不可用时放行，避免限流组件把业务打挂。
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async assertAllowed(key: string, limit: number, windowSec: number, message?: string): Promise<void> {
    try {
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, windowSec);
      if (n > limit) {
        const ttl = await this.redis.ttl(key);
        throw new HttpException(
          message || `请求过于频繁，请约 ${Math.max(1, Math.ceil(ttl / 60))} 分钟后再试`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.warn(`Redis 限流不可用，已放行：${e instanceof Error ? e.message : e}`);
    }
  }
}