import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from '../common/decorators/auth.decorators';

/**
 * 全局 JWT 鉴权：默认所有接口需登录；@Public() 标注的接口跳过。
 * 校验 Authorization: Bearer <JWT>，并把用户挂到 req.user。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();
    const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('未登录或会话已过期，请重新登录');
    const payload = this.auth.verify(token);
    req.user = { username: payload.sub, display_name: payload.name, role: payload.role, system_code: payload.sys || '' };
    req.token = token;
    return true;
  }
}