import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional } from 'class-validator';
import { CaseService } from './case.service';
import { Roles, CurrentUser, RequestUser } from '../common/decorators/auth.decorators';

class CreateCaseDto {
  @IsNotEmpty({ message: '案例标题必填' })
  title: string;

  @IsNotEmpty({ message: '问题现象必填' })
  symptom: string;

  @IsNotEmpty({ message: '根因分析必填' })
  root_cause: string;

  @IsNotEmpty({ message: '解决方式必填' })
  solution: string;

  @IsOptional()
  related_jobs?: string;

  @IsOptional()
  related_tables?: string;

  @IsOptional()
  error_code?: string;
}

@ApiTags('案例库')
@Controller('cases')
export class CaseController {
  constructor(private readonly cases: CaseService) {}

  @Get()
  @ApiOperation({ summary: '案例列表（分页，limit 默认 100 上限 200）' })
  list(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    const l = Math.min(parseInt(limit || '100', 10) || 100, 200);
    const o = Math.max(parseInt(offset || '0', 10) || 0, 0);
    return this.cases.list(l, o);
  }

  @Post()
  @ApiOperation({ summary: '录入案例（自动识别关联作业/表/错误码，查重防重复，归属用户与系统）' })
  create(@Body() dto: CreateCaseDto, @CurrentUser() user: RequestUser) {
    return this.cases.create(dto, { username: user.username, system_code: user.system_code });
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: '删除案例（仅 admin）' })
  async remove(@Param('id') id: string) {
    await this.cases.remove(id);
    return { ok: true };
  }
}