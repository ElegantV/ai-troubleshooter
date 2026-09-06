import { Inject, Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../infra/redis/redis.module';

/** 登录：同一 用户名+IP 连续失败 5 次，锁定 15 分钟（成功登录即清零） */
const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_SEC = 15 * 60;
/** 注册：同 IP 每小时最多 10 次（成功与否都计数，防批量造号） */
const REGISTER_MAX = 10;
const REGISTER_WINDOW_SEC = 60 * 60;

/**
 * 认证接口限流（Redis 计数）。
 * Redis 不可用时放行（fail-open）：限流是加固措施，不能反过来把登录打挂。
 */
@Injectable()
export class AuthThrottleService {
  private readonly logger = new Logger(AuthThrottleService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async assertLoginAllowed(username: string, ip: string): Promise<void> {
    const key = this.key('login', username, ip);
    const n = await this.safe(() => this.redis.get(key), '0');
    if (Number(n) >= LOGIN_MAX_FAILS) {
      const ttl = await this.safe(() => this.redis.ttl(key), LOGIN_WINDOW_SEC);
      const minutes = Math.max(1, Math.ceil(ttl / 60));
      throw new HttpException(`登录失败次数过多，请约 ${minutes} 分钟后再试`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async recordLoginFailure(username: string, ip: string): Promise<void> {
    await this.safe(async () => {
      const key = this.key('login', username, ip);
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, LOGIN_WINDOW_SEC);
    }, null);
  }

  async clearLoginFailures(username: string, ip: string): Promise<void> {
    await this.safe(() => this.redis.del(this.key('login', username, ip)), 0);
  }

  async assertRegisterAllowed(ip: string): Promise<void> {
    const key = this.key('register', ip);
    const n = Number(await this.safe(() => this.redis.incr(key), 1));
    if (n === 1) await this.safe(() => this.redis.expire(key, REGISTER_WINDOW_SEC), null);
    if (n > REGISTER_MAX) {
      const ttl = await this.safe(() => this.redis.ttl(key), REGISTER_WINDOW_SEC);
      const minutes = Math.max(1, Math.ceil(ttl / 60));
      throw new HttpException(`注册过于频繁，请约 ${minutes} 分钟后再试`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private key(...parts: string[]): string {
    return ['auth:limit', ...parts].join(':');
  }

  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      this.logger.warn(`Redis 限流计数不可用，已放行：${e instanceof Error ? e.message : e}`);
      return fallback;
    }
  }
}
