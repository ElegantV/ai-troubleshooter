import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service';

@ApiTags('审计留痕')
@Controller('queries')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: '排查历史（分页）' })
  async list(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    const l = Math.min(parseInt(limit || '20', 10) || 20, 100);
    const o = Math.max(parseInt(offset || '0', 10) || 0, 0);
    return this.audit.list(l, o);
  }

  @Get(':id')
  @ApiOperation({ summary: '排查报告复看' })
  async detail(@Param('id') id: string) {
    const row = await this.audit.detail(id);
    if (!row) throw new NotFoundException('查询记录不存在');
    return row;
  }
}