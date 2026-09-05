import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Knex } from 'knex';
import * as jwt from 'jsonwebtoken';
import { KNEX } from '../infra/database/database.module';
import { AuthProvider, LocalAuthProvider, SsoAuthProvider, AuthUser } from './auth.provider';
import * as crypto from 'crypto';

export interface JwtPayload {
  sub: string;
  name: string;
  role: string;
  sys?: string;
  jti?: string;
}

export interface AuthResult {
  ok: boolean;
  token?: string;
  user?: AuthUser;
  message?: string;
}

const USERNAME_RE = /^[a-z0-9_]{2,32}$/;

/**
 * 认证服务：注册/登录/登出/当前用户 + JWT 签发校验（操作归属落库不变）。
 * 生产替换点：AUTH_PROVIDER=sso 时，SSO 回调经 AuthProvider 换取用户后签发同一 JWT。
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly secret: string;
  private readonly expiresIn: string;
  private readonly provider: AuthProvider;

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    cfg: ConfigService,
    local: LocalAuthProvider,
    sso: SsoAuthProvider,
  ) {
    const app = cfg.get<{ jwt: { secret: string; expiresIn: string } }>('app')!;
    this.secret = app.jwt.secret;
    this.expiresIn = app.jwt.expiresIn;
    this.provider = process.env.AUTH_PROVIDER === 'sso' ? sso : local;
  }

  async register(input: { username?: string; password?: string; display_name?: string; system_code?: string }): Promise<AuthResult> {
    const name = String(input.username || '').trim().toLowerCase();
    if (!USERNAME_RE.test(name)) return { ok: false, message: '用户名限 2-32 位小写字母/数字/下划线' };
    if (String(input.password || '').length < 6) return { ok: false, message: '密码至少 6 位' };
    const provider = this.provider as LocalAuthProvider;
    const user = await provider.register(name, String(input.password), input.display_name, String(input.system_code || '').trim());
    if (!user) return { ok: false, message: `用户 ${name} 已存在，请直接登录` };
    return { ok: true, token: this.sign(user), user };
  }

  async login(input: { username?: string; password?: string }): Promise<AuthResult> {
    const name = String(input.username || '').trim().toLowerCase();
    if (!name || !input.password) return { ok: false, message: '用户名或密码错误' };
    const user = await this.provider.authenticate(name, String(input.password));
    if (!user) return { ok: false, message: '用户名或密码错误' };
    return { ok: true, token: this.sign(user), user };
  }

  sign(user: AuthUser): string {
    const options: jwt.SignOptions = { expiresIn: this.expiresIn as jwt.SignOptions['expiresIn'], jwtid: cryptoRandom() };
    return jwt.sign({ sub: user.username, name: user.display_name, role: user.role, sys: user.system_code }, this.secret, options);
  }

  verify(token: string): JwtPayload {
    try {
      return jwt.verify(token, this.secret) as JwtPayload;
    } catch {
      throw new UnauthorizedException('未登录或会话已过期，请重新登录');
    }
  }

  async me(token: string): Promise<AuthUser | null> {
    const payload = this.verify(token);
    const u = await this.db('users').where({ username: payload.sub }).first();
    if (!u) return null;
    return { username: u.username, display_name: u.display_name, role: u.role || 'user', system_code: u.system_code || '' };
  }

  async logout(token: string): Promise<void> {
    try {
      const payload = this.verify(token);
      this.logger.log(`用户 ${payload.sub} 登出（JWT 无状态，客户端丢弃令牌）`);
    } catch {
      /* 无效令牌直接忽略 */
    }
  }
}

function cryptoRandom(): string {
  return crypto.randomBytes(12).toString('hex');
}