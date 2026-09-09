import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import * as crypto from 'crypto';
import { pinoHttp } from 'pino-http';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { logCtx, PINO, PinoLoggerService } from './common/logger/pino.module';

const CORS_ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function bootstrap(): Promise<void> {
  // bufferLogs：让启动日志也走 pino（Nest 默认在应用创建前输出到 console）
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLoggerService));

  // 请求级上下文：requestId（透传上游 x-request-id，缺省生成）→ 响应头 + 业务日志关联
  app.use((req: { headers: { 'x-request-id'?: string }; id?: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    (req as { requestId?: string }).requestId = requestId;
    res.setHeader('x-request-id', requestId);
    logCtx.run({ requestId }, () => next());
  });

  // 请求访问日志（结构化）：与业务日志共用同一 pino 实例，req.id 与 x-request-id 一致
  const pino = app.get<import('pino').Logger>(PINO);
  app.use(
    pinoHttp({
      logger: pino,
      genReqId: (req: import('http').IncomingMessage & { requestId?: string }) => req.requestId || crypto.randomUUID(),
      autoLogging: { ignore: (req) => !!req.url && (req.url.includes('/api/health') || req.url.includes('/auth/captcha')) },
    }),
  );

  // 安全基线：helmet 安全头 + CORS 白名单 + 响应压缩（nginx 已配 gzip 时压缩层会自适应）
  app.use(helmet());
  if (CORS_ALLOWED_ORIGINS.length > 0) {
    app.enableCors({ origin: CORS_ALLOWED_ORIGINS, credentials: true });
  } else {
    // 开发环境默认同源即可，不开放任意跨域
    app.enableCors({ origin: false });
  }
  app.use(compression());
  // 优雅停机：等待在途请求完成、关闭队列/连接后再退出
  app.enableShutdownHooks();
  const cfg = app.get(ConfigService);
  const appCfg = cfg.get<AppConfig>('app')!;
  // 仅信任来自反代的 XFF：Express 将按 trustProxy 链剥离，req.ip/req.ips 才是真实客户端
  app.getHttpAdapter().getInstance().set('trust proxy', appCfg.trustProxy);
  // /api/v1 版本化前缀；/api/health 整棵子树保持开放（运维探活，含 /live /ready）
  app.setGlobalPrefix('api/v1', { exclude: ['api/health', 'api/health/(.*)'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // Swagger 仅开发环境开放，生产不暴露接口文档
  if ((process.env.NODE_ENV || 'development') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('AI 问题排查助手 API')
      .setDescription('面向数据异常与批量作业失败场景的智能排查服务（NestJS + TypeScript + PostgreSQL + Redis）')
      .setVersion('0.4.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  await app.listen(appCfg.port);
  console.log(`AI 问题排查助手已启动: http://localhost:${appCfg.port}  (Swagger: http://localhost:${appCfg.port}/api/docs)`);
}

bootstrap().catch((e) => {
  console.error('启动失败：', e);
  process.exit(1);
});