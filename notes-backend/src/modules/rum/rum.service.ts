import { Injectable } from '@nestjs/common'

type RumEvent = { type: string; name?: string; value?: number; meta?: any; ts?: number }
type DayStats = { count: number; sum: number }

@Injectable()
export class RumService {
    private store = new Map<string, Map<string, DayStats>>()

    collect(ev: RumEvent) {
        const ts = ev.ts ?? Date.now()
        const d = new Date(ts)
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const key = `${ev.type}:${ev.name || ''}`
        if (!this.store.has(dateKey)) this.store.set(dateKey, new Map())
        const day = this.store.get(dateKey)!
        const cur = day.get(key) || { count: 0, sum: 0 }
        day.set(key, { count: cur.count + 1, sum: cur.sum + Number(ev.value || 0) })
    }

    report(date?: string) {
        const dateKey = date || (() => {
            const d = new Date()
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        })()
        const day = this.store.get(dateKey) || new Map()
        const entries = Array.from(day.entries()).map(([k, v]) => ({ key: k, count: v.count, avg: v.count ? v.sum / v.count : 0 }))
        return { date: dateKey, metrics: entries }
    }
}

