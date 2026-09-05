import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

interface ErrorBody {
  code: number;
  error: string;
}

/** 全局异常统一输出 { code: <http状态>, error: <消息> }，避免堆栈/内部信息泄露到响应 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务异常';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object') {
        const m = (body as Record<string, unknown>).message;
        message = Array.isArray(m) ? (m as string[]).join('；') : String(m ?? exception.message);
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception));

    const body: ErrorBody = { code: status, error: message };
    res.status(status).json(body);
  }
}