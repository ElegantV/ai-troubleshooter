import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration';
import { DatabaseModule } from './infra/database/database.module';
import { RedisModule } from './infra/redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AgentModule } from './agent/agent.module';
import { CaseModule } from './case/case.module';
import { AuditModule } from './audit/audit.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { CollectorModule } from './collector/collector.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { PinoLoggerModule, PinoLoggerService } from './common/logger/pino.module';
import { RateLimitModule } from './common/services/rate-limit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    DatabaseModule,
    RedisModule,
    AuthModule,
    AgentModule,
    CaseModule,
    AuditModule,
    KnowledgeModule,
    CollectorModule,
    PinoLoggerModule,
    RateLimitModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}