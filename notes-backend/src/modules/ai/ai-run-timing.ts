export type AiRunStageName =
  | 'request'
  | 'context_prepare'
  | 'capacity_wait'
  | 'provider'
  | 'validation'
  | 'persistence'
  | 'response'

export type AiRunStage = {
  name: AiRunStageName
  durationMs: number
  status: 'succeeded' | 'failed' | 'skipped'
  attempt?: number
  provider?: string
  model?: string
  fallbackType?: 'quality' | 'provider'
}

export type AiRunMetrics = {
  inputChars?: number
  candidateNotes?: number
  candidateChunks?: number
  outputChars?: number
}

type AiRunStageMetadata = Omit<AiRunStage, 'name' | 'durationMs' | 'status'>

const STAGE_NAMES = new Set<AiRunStageName>([
  'request',
  'context_prepare',
  'capacity_wait',
  'provider',
  'validation',
  'persistence',
  'response',
])

export class AiRunTiming {
  constructor(private readonly onStage: (stage: AiRunStage) => void | Promise<void> = () => undefined) {}

  async measure<T>(name: AiRunStageName, work: () => T | Promise<T>, metadata: AiRunStageMetadata = {}): Promise<T> {
    const startedAt = performance.now()
    try {
      const result = await work()
      await this.emit({ name, durationMs: this.elapsed(startedAt), status: 'succeeded', ...metadata })
      return result
    } catch (error) {
      await this.emit({ name, durationMs: this.elapsed(startedAt), status: 'failed', ...metadata })
      throw error
    }
  }

  private async emit(stage: AiRunStage) {
    await this.onStage(sanitizeAiRunStage(stage))
  }

  private elapsed(startedAt: number) {
    return Math.max(0, Math.floor(performance.now() - startedAt))
  }
}

export function sanitizeAiRunStage(stage: AiRunStage): AiRunStage {
  if (!STAGE_NAMES.has(stage.name)) throw new Error('Unsupported AI run stage name')
  const sanitized: AiRunStage = {
    name: stage.name,
    durationMs: nonNegativeInteger(stage.durationMs),
    status: stage.status,
  }
  if (typeof stage.attempt === 'number' && Number.isFinite(stage.attempt)) sanitized.attempt = nonNegativeInteger(stage.attempt)
  if (typeof stage.provider === 'string' && stage.provider) sanitized.provider = stage.provider.slice(0, 200)
  if (typeof stage.model === 'string' && stage.model) sanitized.model = stage.model.slice(0, 300)
  if (stage.fallbackType === 'quality' || stage.fallbackType === 'provider') sanitized.fallbackType = stage.fallbackType
  return sanitized
}

export function sanitizeAiRunMetrics(metrics: AiRunMetrics): AiRunMetrics {
  const sanitized: AiRunMetrics = {}
  for (const key of ['inputChars', 'candidateNotes', 'candidateChunks', 'outputChars'] as const) {
    const value = metrics[key]
    if (typeof value === 'number' && Number.isFinite(value)) sanitized[key] = nonNegativeInteger(value)
  }
  return sanitized
}

function nonNegativeInteger(value: number): number {
  return Math.max(0, Math.floor(value))
}
