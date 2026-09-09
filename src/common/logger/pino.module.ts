import { Global, Module } from '@nestjs/common';
import { LoggerService } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import pino, { Logger as PinoLogger, stdTimeFunctions } from 'pino';

export const PINO = Symbol('PINO');

/** 请求级上下文：requestId / 当前用户，供业务日志关联（全链路追踪的轻量方案） */
export const logCtx = new AsyncLocalStorage<{ requestId: string; userId?: string }>();

function buildPino(): PinoLogger {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    timestamp: stdTimeFunctions.isoTime,
    base: { app: 'ai-troubleshooter', env: process.env.NODE_ENV || 'development', pid: process.pid },
    redact: { paths: ['req.headers.authorization', 'password', '*.password'], censor: '[REDACTED]' },
  });
}

/**
 * Nest Logger → pino 适配：所有 Logger 调用（含各服务 new Logger(X)）统一走结构化日志，
 * 并自动附带当前请求的 requestId / userId（来自 logCtx）。
 */
export class PinoLoggerService implements LoggerService {
  private readonly logger: PinoLogger;

  constructor() {
    this.logger = buildPino();
  }

  private attach(ctx: string | undefined, rest: unknown[]): Record<string, unknown> {
    const base: Record<string, unknown> = { ...(logCtx.getStore() || {}) };
    if (ctx) base['context'] = ctx;
    if (rest.length > 0) base['extra'] = rest.length === 1 ? rest[0] : rest;
    return base;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    const [context, ...rest] = this.split(optionalParams);
    this.logger.info(this.attach(context, rest), message as string);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const [context, ...rest] = this.split(optionalParams);
    this.logger.error(this.attach(context, rest), message as string);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    const [context, ...rest] = this.split(optionalParams);
    this.logger.warn(this.attach(context, rest), message as string);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    const [context, ...rest] = this.split(optionalParams);
    this.logger.debug(this.attach(context, rest), message as string);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    const [context, ...rest] = this.split(optionalParams);
    this.logger.trace(this.attach(context, rest), message as string);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    const [context, ...rest] = this.split(optionalParams);
    this.logger.fatal(this.attach(context, rest), message as string);
  }

  /** Nest 约定：最后一个字符串参数通常是 context，其余为调用方传入的附加信息 */
  private split(optionalParams: unknown[]): [string | undefined, unknown[]] {
    const rest = [...optionalParams];
    let context: string | undefined;
    if (rest.length > 0 && typeof rest[rest.length - 1] === 'string') {
      context = rest.pop() as string;
    }
    return [context, rest];
  }
}

@Global()
@Module({
  providers: [
    { provide: PINO, useFactory: () => buildPino() },
    PinoLoggerService,
  ],
  exports: [PINO, PinoLoggerService],
})
export class PinoLoggerModule {}