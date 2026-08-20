import { Controller, Get } from '@nestjs/common'

@Controller('health')
export class HealthController {
  @Get()
  get() {
    return {
      status: 'up',
      service_name: 'notes',
      timestamp: new Date().toISOString(),
    }
  }
}
