import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'zhangsan', description: '用户名：2-32 位小写字母/数字/下划线' })
  @Matches(/^[a-z0-9_]{2,32}$/, { message: '用户名限 2-32 位小写字母/数字/下划线' })
  username: string;

  @ApiProperty({ example: 'secret123', description: '密码至少 6 位' })
  @MinLength(6, { message: '密码至少 6 位' })
  password: string;

  @ApiProperty({ required: false, example: '张三' })
  @IsOptional()
  @MaxLength(32)
  display_name?: string;

  @ApiProperty({ required: false, example: 'core', description: '所属系统编码（留空为共享/公共）' })
  @IsOptional()
  @MaxLength(32)
  system_code?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'zhangsan' })
  @IsNotEmpty({ message: '请输入用户名' })
  username: string;

  @ApiProperty({ example: 'secret123' })
  @IsNotEmpty({ message: '请输入密码' })
  password: string;

  @ApiProperty({ description: '图形验证码 ID（GET /auth/captcha 返回）' })
  @IsNotEmpty({ message: '请刷新验证码后重试' })
  captcha_id: string;

  @ApiProperty({ example: 'a3kp', description: '验证码字符（不区分大小写）' })
  @IsNotEmpty({ message: '请输入验证码' })
  captcha_code: string;
}

export class UpdateProfileDto {
  @ApiProperty({ required: false, example: 'zhangsan02', description: '新用户名：2-32 位小写字母/数字/下划线；不传或与原值相同则不改' })
  @IsOptional()
  @Matches(/^[a-z0-9_]{2,32}$/, { message: '用户名限 2-32 位小写字母/数字/下划线' })
  username?: string;

  @ApiProperty({ required: false, example: '张三' })
  @IsOptional()
  @MaxLength(32)
  display_name?: string;

  @ApiProperty({ required: false, example: 'core', description: '所属系统编码（空串 = 共享/公共）' })
  @IsOptional()
  @MaxLength(32)
  system_code?: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'secret123', description: '当前密码' })
  @IsNotEmpty({ message: '请输入当前密码' })
  old_password: string;

  @ApiProperty({ example: 'newsecret123', description: '新密码至少 6 位' })
  @MinLength(6, { message: '新密码至少 6 位' })
  new_password: string;
}