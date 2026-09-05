import { Module } from '@nestjs/common';
import { CollectorService } from './collector.service';
import { SchedulerService } from './scheduler.service';
import { CollectorController } from './collector.controller';

@Module({
  providers: [CollectorService, SchedulerService],
  controllers: [CollectorController],
})
export class CollectorModule {}