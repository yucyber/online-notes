import { Controller, Get } from '@nestjs/common'

@Controller('health')
export class HealthController {
  @Get()
  get() {
    return {
      code: 0,
      message: 'OK',
      data: {
        status: 'up',
        service_name: 'notes',
        timestamp: new Date().toISOString(),
      },
      requestId: 'health-' + Date.now(),
      timestamp: new Date().toISOString(),
    }
  }
}
