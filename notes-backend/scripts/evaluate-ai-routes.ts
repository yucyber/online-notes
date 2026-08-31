import { ConfigService } from '@nestjs/config'
import * as dotenv from 'dotenv'
import { AiGatewayClient } from '../src/modules/ai/ai-gateway.client'
import { AiChatOptions, AiTask } from '../src/modules/ai/ai-gateway.types'

export interface AiEvaluationSample extends AiChatOptions {
  task: AiTask
}

export interface AiRouteEvaluationReport {
  startedAt: string
  routes: Array<{
    task: AiTask
    provider: string
    model: string
    samples: number
    validRate: number
    emptyContentRate: number
    fallbackRate: number
    p50Ms: number
    p95Ms: number
  }>
}

export async function evaluateAiRouteSamples(
  gateway: Pick<AiGatewayClient, 'chatTask' | 'describeTaskRoute'>,
  samples: AiEvaluationSample[],
): Promise<AiRouteEvaluationReport> {
  const groups = new Map<AiTask, Array<{ valid: boolean; empty: boolean; fallback: boolean; durationMs: number }>>()
  for (const sample of samples) {
    const rows = groups.get(sample.task) || []
    try {
      const result = await gateway.chatTask(sample)
      const empty = !String(result.content || '').trim()
      rows.push({
        valid: !empty,
        empty,
        fallback: Boolean(result.attempt?.fallbackUsed),
        durationMs: Number(result.attempt?.durationMs || 0),
      })
    } catch {
      rows.push({ valid: false, empty: true, fallback: false, durationMs: 0 })
    }
    groups.set(sample.task, rows)
  }

  return {
    startedAt: new Date().toISOString(),
    routes: [...groups.entries()].map(([task, rows]) => {
      const route = gateway.describeTaskRoute(task)
      const durations = rows.map(row => row.durationMs).sort((a, b) => a - b)
      return {
        task,
        provider: route.provider,
        model: route.model,
        samples: rows.length,
        validRate: rate(rows, row => row.valid),
        emptyContentRate: rate(rows, row => row.empty),
        fallbackRate: rate(rows, row => row.fallback),
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
      }
    }),
  }
}

function rate<T>(rows: T[], predicate: (row: T) => boolean) {
  return rows.length ? rows.filter(predicate).length / rows.length : 0
}

function percentile(values: number[], quantile: number) {
  if (!values.length) return 0
  return values[Math.max(0, Math.ceil(values.length * quantile) - 1)]
}

function fixedSamples(): AiEvaluationSample[] {
  const samples: AiEvaluationSample[] = []
  for (let index = 0; index < 5; index += 1) {
    samples.push({
      task: 'note_summary',
      system: 'Return only a concise Chinese summary.',
      prompt: `匿名笔记 ${index + 1}：React 列表应使用稳定 key，避免复用错误的组件状态。请保留这个关键事实。`,
      maxTokens: 128,
    })
    samples.push({
      task: 'knowledge_graph',
      system: 'Return JSON only.',
      prompt: 'Extract a graph as {"nodes":[],"edges":[]} from: React Diff relates to stable key.',
      responseFormat: { type: 'json_object' },
    })
    samples.push({
      task: 'organizer_proposal',
      system: 'Return JSON only.',
      prompt: 'Return {"actions":[{"type":"add_tag","noteIds":["note-1"]}]}.',
      allowedNoteIds: ['note-1'],
      responseFormat: { type: 'json_object' },
    })
    samples.push({
      task: 'rag_answer',
      system: 'Answer only from the supplied evidence.',
      prompt: 'Evidence: stable key prevents incorrect component reuse. Question: why use a stable key?',
      maxTokens: 256,
    })
  }
  return samples
}

async function main() {
  dotenv.config()
  const gateway = new AiGatewayClient(new ConfigService(process.env))
  const report = await evaluateAiRouteSamples(gateway, fixedSamples())
  console.log(JSON.stringify(report, null, 2))
  if (report.routes.some(route => route.validRate !== 1 || route.emptyContentRate !== 0)) process.exitCode = 1
}

if (require.main === module) void main()
