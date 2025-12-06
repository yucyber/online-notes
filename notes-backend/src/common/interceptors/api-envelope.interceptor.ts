import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

@Injectable()
export class ApiEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp()
    const req = ctx.getRequest<Request & { headers?: any }>()
    const res = ctx.getResponse<any>()
    const requestId = (req?.headers?.['x-request-id'] as string) || `${Date.now()}-${Math.random()}`
    try { res.setHeader('X-Request-Id', requestId) } catch {}
    return next.handle().pipe(
      map((data) => {
        // 如果已经是统一包结构则直接返回
        if (data && typeof data === 'object' && 'code' in data && 'message' in data && 'timestamp' in data) {
          return data
        }
        return {
          code: 0,
          message: 'OK',
          data,
          requestId,
          timestamp: new Date().toISOString(),
        }
      }),
    )
  }
}
