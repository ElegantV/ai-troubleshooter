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

  /**
   * 维护个人资料（仅本人）。改登录名时 JWT 的 sub 变化，需重签令牌；
   * query_log.user_name 为纯文本审计快照，历史记录保留改名前的用户名。
   */
  async updateProfile(
    current: string,
    input: { username?: string; display_name?: string; system_code?: string },
  ): Promise<AuthResult> {
    const patch: { username?: string; display_name?: string; system_code?: string } = {};
    if (input.username !== undefined && input.username !== current) {
      const name = String(input.username).trim().toLowerCase();
      if (!USERNAME_RE.test(name)) return { ok: false, message: '用户名限 2-32 位小写字母/数字/下划线' };
      const exists = await this.db('users').where({ username: name }).first();
      if (exists) return { ok: false, message: `用户 ${name} 已存在` };
      patch.username = name;
    }
    if (input.display_name !== undefined) patch.display_name = String(input.display_name);
    if (input.system_code !== undefined) patch.system_code = String(input.system_code);
    const user = await (this.provider as LocalAuthProvider).updateProfile(current, patch);
    if (!user) return { ok: false, message: '用户不存在' };
    return { ok: true, token: this.sign(user), user };
  }

  async changePassword(current: string, input: { old_password?: string; new_password?: string }): Promise<AuthResult> {
    const oldPwd = String(input.old_password || '');
    const newPwd = String(input.new_password || '');
    if (!oldPwd || !newPwd) return { ok: false, message: '请输入当前密码和新密码' };
    if (newPwd.length < 6) return { ok: false, message: '新密码至少 6 位' };
    if (!(await this.provider.authenticate(current, oldPwd))) return { ok: false, message: '当前密码不正确' };
    if (!(await (this.provider as LocalAuthProvider).setPassword(current, newPwd))) {
      return { ok: false, message: '用户不存在' };
    }
    return { ok: true, message: '密码已更新' };
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