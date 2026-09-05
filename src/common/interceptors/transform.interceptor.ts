import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';

export interface Envelope<T = unknown> {
  code: number;
  data: T;
}

/** 统一成功包络：{ code: 0, data }（错误统一由 AllExceptionsFilter 输出 { code, error }） */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Envelope<T>> {
  intercept(_ctx: ExecutionContext, next: CallHandler<T>): Observable<Envelope<T>> {
    return next.handle().pipe(map((data) => ({ code: 0, data })));
  }
}