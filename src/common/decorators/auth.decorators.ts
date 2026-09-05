import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const IS_PUBLIC_KEY = 'isPublic';

/** 声明接口所需角色：@Roles('admin') */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** 标记为公开接口（跳过全局 JWT 鉴权）：@Public() */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export interface RequestUser {
  username: string;
  display_name: string;
  role: string;
  system_code: string;
}

/** 取当前登录用户（须经过全局 JWT 鉴权） */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestUser => {
  return ctx.switchToHttp().getRequest().user;
});