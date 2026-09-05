import { Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CollectorService } from './collector.service';
import { Roles } from '../common/decorators/auth.decorators';

@ApiTags('运维')
@Controller('admin')
export class CollectorController {
  constructor(private readonly collector: CollectorService) {}

  @Roles('admin')
  @Post('collect')
  @ApiOperation({ summary: '手动触发知识库刷新（仅 admin）' })
  async collect() {
    return this.collector.refresh();
  }
}