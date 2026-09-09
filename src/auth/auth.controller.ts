import { Body, Controller, Get, Headers, HttpCode, Patch, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { AuthThrottleService } from './auth-throttle.service';
import { CaptchaService } from './captcha.service';
import { ChangePasswordDto, LoginDto, RegisterDto, UpdateProfileDto } from './dto/auth.dto';
import { CurrentUser, Public, RequestUser } from '../common/decorators/auth.decorators';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly throttle: AuthThrottleService,
    private readonly captcha: CaptchaService,
  ) {}

  /**
   * 取真实客户端 IP：trust proxy 已配置（TRUST_PROXY，仅信任反代网段），
   * req.ips[0] 为 Express 剥离伪造头后的首个外网 IP；直连时回退 req.ip。
   * 仅用于限流计数，不用于审计归属。
   */
  private clientIp(req: Request): string {
    const ips = req.ips;
    return (ips && ips.length > 0 ? ips[0] : req.ip) || '';
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: '注册（注册即自动登录）' })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    await this.throttle.assertRegisterAllowed(this.clientIp(req));
    return this.auth.register(dto);
  }

  @Public()
  @Get('captcha')
  @ApiOperation({ summary: '登录图形验证码（一次性，5 分钟有效）' })
  getCaptcha() {
    return this.captcha.create();
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: '登录（图形验证码 + 同 用户名+IP 连续失败 5 次锁定 15 分钟）' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const name = String(dto.username || '').trim().toLowerCase();
    const ip = this.clientIp(req);
    await this.throttle.assertLoginAllowed(name, ip);
    if (!(await this.captcha.verify(dto.captcha_id, dto.captcha_code))) {
      return { ok: false, message: '验证码不正确或已过期' };
    }
    const r = await this.auth.login(dto);
    if (r.ok) await this.throttle.clearLoginFailures(name, ip);
    else await this.throttle.recordLoginFailure(name, ip);
    return r;
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

  @Patch('profile')
  @ApiOperation({ summary: '维护个人资料（登录名/姓名/所属系统，改登录名返回新令牌）' })
  updateProfile(@CurrentUser() user: RequestUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user.username, dto);
  }

  @Post('password')
  @HttpCode(200)
  @ApiOperation({ summary: '修改密码（需验证当前密码）' })
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.username, dto);
  }
}