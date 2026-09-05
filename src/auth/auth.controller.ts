import { Body, Controller, Get, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { CurrentUser, Public, RequestUser } from '../common/decorators/auth.decorators';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: '注册（注册即自动登录）' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: '登录' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: '登出（JWT 无状态，客户端丢弃令牌）' })
  async logout(@Headers('authorization') authorization?: string) {
    await this.auth.logout(String(authorization || '').replace(/^Bearer\s+/i, ''));
    return { ok: true };
  }

  @Public()
  @Get('me')
  @ApiOperation({ summary: '当前登录用户（未登录返回 401）' })
  async me(@Headers('authorization') authorization?: string) {
    const user = await this.auth.me(String(authorization || '').replace(/^Bearer\s+/i, ''));
    if (!user) throw new UnauthorizedException('未登录或会话已过期，请重新登录');
    return user;
  }

  @Get('whoami')
  @ApiOperation({ summary: '当前登录用户（需登录）' })
  whoami(@CurrentUser() user: RequestUser) {
    return user;
  }
}