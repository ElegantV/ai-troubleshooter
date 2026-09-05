import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // /api/v1 版本化前缀；/api/health 保持开放（运维探活）
  app.setGlobalPrefix('api/v1', { exclude: ['api/health'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const cfg = app.get(ConfigService);
  const appCfg = cfg.get<AppConfig>('app')!;

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI 问题排查助手 API')
    .setDescription('面向数据异常与批量作业失败场景的智能排查服务（NestJS + TypeScript + PostgreSQL + Redis）')
    .setVersion('0.4.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(appCfg.port);
  console.log(`AI 问题排查助手已启动: http://localhost:${appCfg.port}  (Swagger: http://localhost:${appCfg.port}/api/docs)`);
}

bootstrap().catch((e) => {
  console.error('启动失败：', e);
  process.exit(1);
});