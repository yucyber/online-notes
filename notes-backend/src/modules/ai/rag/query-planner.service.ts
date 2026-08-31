import { Injectable } from '@nestjs/common'
import { AiGatewayClient } from '../ai-gateway.client'
import { RagPlan, RagTool } from './rag.types'

const SAFE_TOOLS: RagTool[] = ['keyword', 'chunk_vector', 'rerank']

@Injectable()
export class QueryPlannerService {
  constructor(private readonly gateway: AiGatewayClient) {}

  async plan(question: string): Promise<RagPlan> {
    const normalized = String(question || '').trim()
    const local = this.localPlan(normalized)
    if (local) return local
    try {
      const result = await this.gateway.chatTask({
        task: 'query_plan', responseFormat: { type: 'json_object' }, maxTokens: 256, temperature: 0,
        system: 'Plan read-only retrieval only. Return JSON with intent, tools, reasoningMode, graphHops.',
        prompt: normalized,
      })
      return this.sanitizePlan(JSON.parse(result.content), { intent: 'organize', tools: SAFE_TOOLS, reasoningMode: 'deep', graphHops: 0 })
    } catch {
      return { intent: 'organize', tools: SAFE_TOOLS, reasoningMode: 'deep', graphHops: 0 }
    }
  }

  private localPlan(question: string): RagPlan | undefined {
    if (!question) return { intent: 'lookup', tools: [], reasoningMode: 'off', graphHops: 0 }
    if (/(区别|差异|对比|比较|冲突|矛盾)/i.test(question)) return { intent: 'compare', tools: ['chunk_vector', 'graph_expand', 'rerank'], reasoningMode: 'deep', graphHops: 1 }
    if (/(我之前|当时|踩坑|我的笔记里|我的笔记|我遇到)/i.test(question)) return { intent: 'user_history', tools: ['keyword', 'chunk_vector', 'rerank'], reasoningMode: 'off', graphHops: 0 }
    if (/(整理|归类|分类|重组|合并笔记)/i.test(question)) return { intent: 'organize', tools: SAFE_TOOLS, reasoningMode: 'deep', graphHops: 0 }
    if (/(查找|找到|标题|哪篇|搜索)/i.test(question)) return { intent: 'lookup', tools: ['keyword', 'chunk_vector', 'rerank'], reasoningMode: 'off', graphHops: 0 }
    if (question.length >= 2) return { intent: 'explain', tools: ['chunk_vector', 'rerank'], reasoningMode: 'off', graphHops: 0 }
    return undefined
  }

  private sanitizePlan(value: any, fallback: RagPlan): RagPlan {
    const intent = ['lookup', 'explain', 'compare', 'user_history', 'organize'].includes(value?.intent) ? value.intent : fallback.intent
    const tools: RagTool[] = Array.isArray(value?.tools)
      ? value.tools.flatMap((tool: unknown) => {
        const candidate = String(tool)
        return ['keyword', 'chunk_vector', 'graph_expand', 'rerank'].includes(candidate) ? [candidate as RagTool] : []
      })
      : fallback.tools
    const uniqueTools = [...new Set(tools)]
    const graphExpand = uniqueTools.includes('graph_expand') && intent === 'compare'
    const sanitizedTools = uniqueTools.filter((tool) => tool !== 'graph_expand' || graphExpand)
    return {
      intent,
      tools: sanitizedTools.length ? sanitizedTools : fallback.tools,
      reasoningMode: ['compare', 'organize'].includes(intent) ? 'deep' : 'off',
      graphHops: graphExpand ? 1 : 0,
    }
  }
}
