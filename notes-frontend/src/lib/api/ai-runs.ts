import api from './client'

export type AiRunStatus = 'running' | 'succeeded' | 'failed'

export type AiRunStageName =
  | 'request'
  | 'context_prepare'
  | 'capacity_wait'
  | 'provider'
  | 'validation'
  | 'persistence'
  | 'response'

export interface AiRunStage {
  name: AiRunStageName
  durationMs: number
  status: 'succeeded' | 'failed' | 'skipped'
  attempt?: number
  provider?: string
  model?: string
  fallbackType?: 'quality' | 'provider'
}

export interface AiRunMetrics {
  inputChars?: number
  candidateNotes?: number
  candidateChunks?: number
  outputChars?: number
}

export interface AiRun {
  runId: string
  graphName: string
  task?: string
  reasoningMode?: 'off' | 'auto' | 'deep'
  provider?: string
  model?: string
  durationMs?: number
  retryCount?: number
  fallbackUsed?: boolean
  fallbackType?: 'quality' | 'provider'
  fallbackReason?: string
  finishReason?: string
  contentChars?: number
  reasoningChars?: number
  validationResult?: 'valid' | 'invalid'
  stages: AiRunStage[]
  metrics: AiRunMetrics
  status: AiRunStatus
  createdAt?: string
  updatedAt?: string
  finishedAt?: string
}

export interface AiRunStagePerformance {
  name: string
  requestCount: number
  p50Ms: number
  p95Ms: number
}

export interface AiRunTaskPerformance {
  task: string
  requestCount: number
  successRate: number
  fallbackRate: number
  p50Ms: number
  p95Ms: number
  stages: AiRunStagePerformance[]
}

export interface AiRunPerformance {
  requestCount: number
  successRate: number
  fallbackRate: number
  p50Ms: number
  p95Ms: number
  byTask: AiRunTaskPerformance[]
  recentRuns: {
    items: AiRun[]
    page: number
    size: number
    total: number
    totalPages: number
  }
}

export interface AiRunPerformanceQuery {
  from: string
  to: string
  task?: string
  page: number
  size: number
}

export const aiRunsAPI = {
  getPerformance: (query: AiRunPerformanceQuery, signal?: AbortSignal) =>
    api.get<AiRunPerformance>('/ai/runs/performance', { params: query, signal, timeout: 10000 })
      .then((response) => response as unknown as AiRunPerformance),

  getRun: (runId: string, signal?: AbortSignal) =>
    api.get<AiRun>(`/ai/runs/${encodeURIComponent(runId)}`, { signal, timeout: 10000 })
      .then((response) => response as unknown as AiRun),
}
