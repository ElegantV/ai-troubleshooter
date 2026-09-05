import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, Matches, MaxLength } from 'class-validator';
import { WorkflowService } from './workflow.service';
import { CurrentUser, RequestUser } from '../common/decorators/auth.decorators';

class TroubleshootDto {
  @IsNotEmpty({ message: '请输入异常表、字段、失败作业或现象描述' })
  @MaxLength(5000, { message: '输入过长（上限 5000 字符），请粘贴关键报错片段或补充说明' })
  text: string;
}

class FeedbackDto {
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, { message: 'query_id 格式无效' })
  query_id: string;

  @IsIn(['yes', 'no'], { message: 'helpful 仅支持 yes/no' })
  helpful: string;

  @IsOptional()
  confirmed_cause?: string;

  @IsOptional()
  note?: string;
}

@ApiTags('智能排查')
@Controller()
export class AgentController {
  constructor(private readonly workflow: WorkflowService) {}

  @Post('troubleshoot')
  @ApiOperation({ summary: '智能排查：输入异常/失败描述，返回可解释报告（按用户所属系统收敛检索）' })
  async troubleshoot(@Body() dto: TroubleshootDto, @CurrentUser() user: RequestUser) {
    return this.workflow.analyze(dto.text, user.username, user.system_code);
  }

  @Post('feedback')
  @HttpCode(200)
  @ApiOperation({ summary: '排查反馈：确认结论并自动沉淀案例（数据飞轮，归属用户与系统）' })
  async feedback(@Body() dto: FeedbackDto, @CurrentUser() user: RequestUser) {
    return this.workflow.saveFeedback(dto, user.username, user.system_code);
  }
}