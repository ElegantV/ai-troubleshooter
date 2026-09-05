import { Module } from '@nestjs/common';
import { KnowledgeController, HealthController } from './knowledge.controller';

@Module({
  controllers: [KnowledgeController, HealthController],
})
export class KnowledgeModule {}