import { Global, Module } from '@nestjs/common';
import { GraphQueryService } from './graph-query.service';
import { EntityExtractService } from './entity-extract.service';
import { RulesService } from './rules.service';
import { ProcAnalysisService } from './proc-analysis.service';
import { RetrievalService, SEARCH_ADAPTER, Bm25SearchAdapter } from './retrieval.service';
import { VerifySqlService } from './verify-sql.service';
import { LlmService } from './llm.service';
import { WorkflowService } from './workflow.service';
import { AgentController } from './agent.controller';

/** 智能体编排域（全局导出，供知识/案例/审计/采集域复用） */
@Global()
@Module({
  providers: [
    GraphQueryService,
    EntityExtractService,
    RulesService,
    ProcAnalysisService,
    RetrievalService,
    VerifySqlService,
    LlmService,
    WorkflowService,
    { provide: SEARCH_ADAPTER, useClass: Bm25SearchAdapter },
    AgentController,
  ],
  controllers: [AgentController],
  exports: [
    GraphQueryService,
    EntityExtractService,
    RulesService,
    ProcAnalysisService,
    RetrievalService,
    VerifySqlService,
    WorkflowService,
  ],
})
export class AgentModule {}