import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
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

    @UseGuards(AuthGuard('jwt'))
    @Get('report')
    report(@Query('date') date?: string) {
        const r = this.rum.report(date)
        return { code: 0, message: 'OK', data: r }
    }
}
