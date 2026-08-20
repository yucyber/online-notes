import { Body, Controller, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { RumService } from './rum.service'
import { RumCollectDto } from './dto'

@Controller('rum')
export class RumController {
    constructor(private readonly rum: RumService) { }

    @Throttle({ short: { ttl: 60_000, limit: 60 } })
    @Post('collect')
    collect(@Body() body: RumCollectDto) {
        const ev = { type: body.type, name: body.name || '', meta: body.meta, ts: Date.now() }
        this.rum.collect(ev)
        return { code: 0, message: 'OK', data: { accepted: true } }
    }
}
