import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { RumService } from './rum.service'

@Controller('rum')
export class RumController {
    constructor(private readonly rum: RumService) { }

    @Post('collect')
    collect(@Body() body: any) {
        const ev = { type: String(body?.type || ''), name: String(body?.name || ''), value: Number(body?.value || 0), meta: body?.meta, ts: Number(body?.ts || Date.now()) }
        this.rum.collect(ev)
        return { code: 0, message: 'OK', data: { accepted: true } }
    }

    @Get('report')
    report(@Query('date') date?: string) {
        const r = this.rum.report(date)
        return { code: 0, message: 'OK', data: r }
    }
}

