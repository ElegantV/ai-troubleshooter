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

/** scrypt 异步版：避免阻塞事件循环（参数与历史 scryptSync 版一致，哈希结果互通） */
function hash(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, 32, (err, key) =>
      err ? reject(err) : resolve(key.toString('hex')),
    );
  });
}

/** 本地实现：users 表 + scrypt 加盐哈希（原 src/auth.js 平移） */
@Injectable()
export class LocalAuthProvider implements AuthProvider {
  readonly name = 'local' as const;

  constructor(@Inject(KNEX) private readonly db: Knex) {}

  async authenticate(username: string, password: string): Promise<AuthUser | null> {
    const u = await this.db('users').where({ username }).first();
    if (!u || (await hash(password, u.salt)) !== u.password_hash) return null;
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
      password_hash: await hash(password, salt),
      salt,
      role: 'user',
      system_code,
      created_at: new Date().toISOString(),
    });
    return { username: name, display_name: String(display_name || '').trim() || name, role: 'user', system_code };
  }

  /** 维护个人资料：可改登录名/姓名/所属系统。改登录名前由调用方校验唯一性 */
  async updateProfile(
    username: string,
    patch: { username?: string; display_name?: string; system_code?: string },
  ): Promise<AuthUser | null> {
    const updates: Record<string, string> = {};
    if (patch.username !== undefined) updates.username = patch.username;
    if (patch.display_name !== undefined) updates.display_name = String(patch.display_name).trim();
    if (patch.system_code !== undefined) updates.system_code = String(patch.system_code).trim();
    if (!Object.keys(updates).length) return this.get(username);
    const n = await this.db('users').where({ username }).update(updates);
    if (!n) return null;
    return this.get(updates.username || username);
  }

  /** 改密码：旧密码校验由调用方先做（authenticate） */
  async setPassword(username: string, newPassword: string): Promise<boolean> {
    const salt = crypto.randomBytes(16).toString('hex');
    const n = await this.db('users').where({ username }).update({ password_hash: await hash(newPassword, salt), salt });
    return n > 0;
  }

  async get(username: string): Promise<AuthUser | null> {
    const u = await this.db('users').where({ username }).first();
    return u ? { username: u.username, display_name: u.display_name, role: u.role || 'user', system_code: u.system_code || '' } : null;
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