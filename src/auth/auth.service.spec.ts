import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestCtx, destroyCtx, TestCtx } from '../../test/helpers';
import { AuthService } from './auth.service';
import { LocalAuthProvider, SsoAuthProvider } from './auth.provider';

const fakeCfg = {
  get: (key: string) => (key === 'app' ? { jwt: { secret: 'test-secret', expiresIn: '1d' } } : undefined),
} as any;

let ctx: TestCtx;

beforeAll(async () => {
  ctx = await createTestCtx();
});

afterAll(async () => {
  await destroyCtx(ctx);
});

function makeAuth() {
  return new AuthService(ctx.db, fakeCfg, new LocalAuthProvider(ctx.db), new SsoAuthProvider());
}

describe('认证服务（本地适配器）', () => {
  it('注册返回 JWT 与用户（默认角色 user）', async () => {
    const svc = makeAuth();
    const r = await svc.register({ username: 'tester1', password: 'pass123' });
    expect(r.ok).toBe(true);
    expect(r.token).toBeTruthy();
    expect(r.user?.role).toBe('user');
    const payload = svc.verify(r.token!);
    expect(payload.sub).toBe('tester1');
    await ctx.db('users').where({ username: 'tester1' }).del();
  });

  it('重复注册被拒绝', async () => {
    const svc = makeAuth();
    await svc.register({ username: 'tester2', password: 'pass123' });
    const r = await svc.register({ username: 'tester2', password: 'pass123' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('已存在');
    await ctx.db('users').where({ username: 'tester2' }).del();
  });

  it('密码错误登录失败', async () => {
    const svc = makeAuth();
    await svc.register({ username: 'tester3', password: 'pass123' });
    const r = await svc.login({ username: 'tester3', password: 'wrong' });
    expect(r.ok).toBe(false);
    await ctx.db('users').where({ username: 'tester3' }).del();
  });

  it('me 返回用户含角色；非法令牌抛 UnauthorizedException', async () => {
    const svc = makeAuth();
    const r = await svc.register({ username: 'tester4', password: 'pass123' });
    const me = await svc.me(r.token!);
    expect(me?.username).toBe('tester4');
    expect(() => svc.verify('not-a-token')).toThrow();
    await ctx.db('users').where({ username: 'tester4' }).del();
  });

  it('用户名/密码格式校验', async () => {
    const svc = makeAuth();
    const bad = await svc.register({ username: 'X!', password: '123' });
    expect(bad.ok).toBe(false);
  });
});