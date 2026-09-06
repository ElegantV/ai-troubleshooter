import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthThrottleService } from './auth-throttle.service';
import { CaptchaService } from './captcha.service';
import { AuthController } from './auth.controller';
import { LocalAuthProvider, SsoAuthProvider } from './auth.provider';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  providers: [AuthService, AuthThrottleService, CaptchaService, LocalAuthProvider, SsoAuthProvider, JwtAuthGuard, RolesGuard],
  controllers: [AuthController],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}