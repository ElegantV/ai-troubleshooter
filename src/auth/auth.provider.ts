/**
 * 认证提供者抽象：当前实现为本地用户名密码；生产替换为行内 SSO（OIDC/CAS/LDAP）。
 * 适配层保证 auth.service 的业务（签发/校验/操作归属）不依赖具体认证来源。
 */
import { Injectable, Inject } from '@nestjs/common';
import * as crypto from 'crypto';
import { Knex } from 'knex';
import { KNEX } from '../infra/database/database.module';

export interface AuthUser {
  username: string;
  display_name: string;
  role: string;
  system_code: string;
}

export interface AuthProvider {
  readonly name: 'local' | 'sso';
  /** 用户名密码登录（本地 / 或转发到企业身份平台） */
  authenticate(username: string, password: string): Promise<AuthUser | null>;
  /** SSO 授权码换用户（OIDC 回调）；本地实现不适用 */
  exchangeCode?(code: string): Promise<AuthUser | null>;
}

function hash(password: string, salt: string): string {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

/** 本地实现：users 表 + scrypt 加盐哈希（原 src/auth.js 平移） */
@Injectable()
export class LocalAuthProvider implements AuthProvider {
  readonly name = 'local' as const;

  constructor(@Inject(KNEX) private readonly db: Knex) {}

  async authenticate(username: string, password: string): Promise<AuthUser | null> {
    const u = await this.db('users').where({ username }).first();
    if (!u || hash(password, u.salt) !== u.password_hash) return null;
    return { username: u.username, display_name: u.display_name, role: u.role || 'user', system_code: u.system_code || '' };
  }

  async register(username: string, password: string, display_name?: string, system_code = ''): Promise<AuthUser | null> {
    const name = String(username || '').trim().toLowerCase();
    const exists = await this.db('users').where({ username: name }).first();
    if (exists) return null;
    const salt = crypto.randomBytes(16).toString('hex');
    await this.db('users').insert({
      username: name,
      display_name: String(display_name || '').trim() || name,
      password_hash: hash(password, salt),
      salt,
      role: 'user',
      system_code,
      created_at: new Date().toISOString(),
    });
    return { username: name, display_name: String(display_name || '').trim() || name, role: 'user', system_code };
  }
}

/** SSO 适配器占位：AUTH_PROVIDER=sso 时启用。生产实现 OIDC 授权码流程 + 用户角色映射（LDAP 组 → role） */
@Injectable()
export class SsoAuthProvider implements AuthProvider {
  readonly name = 'sso' as const;
  async authenticate(): Promise<AuthUser | null> {
    throw new Error('SSO 适配器未配置：请接入行内 OIDC/CAS/LDAP 后启用');
  }
  async exchangeCode(): Promise<AuthUser | null> {
    throw new Error('SSO 适配器未配置：请接入行内 OIDC/CAS/LDAP 后启用');
  }
}