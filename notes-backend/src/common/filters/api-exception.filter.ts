import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<any>()
    const req = ctx.getRequest<Request & { headers?: any }>()

    const requestId = (req?.headers?.['x-request-id'] as string) || `${Date.now()}-${Math.random()}`
    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let message = 'Internal Server Error'
    let code = 50000

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const response: any = exception.getResponse()
      message = (response && (response.message || response.error)) || exception.message || message
      // 错误码映射
      switch (status) {
        case HttpStatus.BAD_REQUEST:
          code = 40010
          break
        case HttpStatus.UNAUTHORIZED:
          code = 40100
          break
        case HttpStatus.FORBIDDEN:
          code = 40300
          break
        case HttpStatus.NOT_FOUND:
          code = 40400
          break
        case HttpStatus.CONFLICT:
          code = 40910
          break
        case HttpStatus.PRECONDITION_FAILED:
          code = 41200
          break
        case HttpStatus.TOO_MANY_REQUESTS:
          code = 42900
          break
        case HttpStatus.SERVICE_UNAVAILABLE:
          code = 50300
          break
        default:
          code = 50000
      }
    }

    res.status(status).json({
      code,
      message,
      data: null,
      requestId,
      timestamp: new Date().toISOString(),
    })
  }
}

