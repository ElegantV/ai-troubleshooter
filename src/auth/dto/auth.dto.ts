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
}