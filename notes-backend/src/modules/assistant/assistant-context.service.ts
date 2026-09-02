import { Inject, Injectable, Optional } from '@nestjs/common'
import { AssistantMessagesService } from './assistant-messages.service'
import { AssistantCheckpointService } from './assistant-checkpoint.service'
import { MEMORY_RECALL_SERVICE, MemoryRecallServiceLike } from './assistant.constants'

// 各分区字符预算：摘要/近期对话/历史召回/认知 依次截断，防止长会话撑爆模型上下文。
const BUDGETS = { summary: 800, recent: 3000, recall: 1200, memory: 800 }

@Injectable()
export class AssistantContextService {
  constructor(
    private readonly messages: AssistantMessagesService,
    private readonly checkpoints: AssistantCheckpointService,
    @Optional() @Inject(MEMORY_RECALL_SERVICE) private readonly memoryRecall?: MemoryRecallServiceLike,
  ) {}

  async assemble(input: { userId: string; conversationId: string; question: string; memoryRecall?: MemoryRecallServiceLike }) {
    const recall = input.memoryRecall ?? this.memoryRecall
    const checkpoint = await this.checkpoints.getLatest(input.userId, input.conversationId)
    const throughSeq = checkpoint?.throughSeq ?? 0

    // 近期对话：checkpoint 之后（throughSeq 之后的 seq）升序取最近 12 条；返回视图供流式端复用。
    const recentAll = await this.messages.list(input.userId, input.conversationId, { afterSeq: throughSeq })
    // 只取已落定消息：pending 占位（刚创建、空内容）与 failed/cancelled 不参与上下文，与 checkpoint/分支只带 completed 的口径一致。
    const recent = recentAll.filter((m) => m.status === 'completed')
    const recentMessages = recent.slice(-12).map((m) => ({ seq: m.seq, role: m.role, content: m.content }))

    const sections: Array<{ label: string; content: string }> = []
    if (checkpoint) {
      const decisions = checkpoint.decisions.length ? `决定：${checkpoint.decisions.join('；')}` : ''
      const open = checkpoint.openQuestions.length ? `待解决：${checkpoint.openQuestions.join('；')}` : ''
      sections.push({ label: '会话摘要', content: [checkpoint.summary, decisions, open].filter(Boolean).join('\n').slice(0, BUDGETS.summary) })
    }
    const recentText = recentMessages.map((m) => `${m.role}: ${m.content}`).join('\n').slice(0, BUDGETS.recent)
    if (recentText) sections.push({ label: '近期对话', content: recentText })

    // 历史召回：checkpoint 之前的消息里按问题关键词命中，最多 4 条。
    const hits = await this.recallHistorical(input.userId, input.conversationId, input.question, throughSeq)
    if (hits.length > 0) sections.push({ label: '历史对话召回', content: hits.join('\n').slice(0, BUDGETS.recall) })

    if (recall) {
      const memories = await recall.recall(input.userId, input.question, { conversationId: input.conversationId })
      if (memories.length > 0) {
        sections.push({ label: '已确认认知', content: memories.map((m) => `[M] ${m.label}：${m.text}`).join('\n').slice(0, BUDGETS.memory) })
      }
    }
    return { sections, recentMessages }
  }

  buildPrompt(question: string, sections: Array<{ label: string; content: string }>) {
    return [question, '', ...sections.map((s) => `[${s.label}]\n${s.content}`)].join('\n\n')
  }

  private async recallHistorical(userId: string, conversationId: string, question: string, throughSeq: number) {
    // 中文分词：空格 split 对 CJK 无效（整句成 1 token，历史召回必然落空）。
    // 按字符类别切分：CJK 连续段拆 2 字滑动窗口（bigram：'全屏尺寸多少合适' → 全屏/屏尺/尺寸/寸多/多少/少合/合适），
    // 非 CJK 片段按空白与标点拆成词级 token（'React diff' → React/diff，标点不粘连）；任一命中即召回，最多 6 词防正则过长。
    const isCjk = (ch: string) => /[\u4e00-\u9fff]/.test(ch)
    const isSep = (ch: string) => /[\s,.;:!?，。；：！？、（）()[\]{}"'“”‘’—…]/.test(ch)
    const words: string[] = []
    const cjkChars: string[] = []
    let buf = ''
    for (const ch of question) {
      if (isCjk(ch)) {
        cjkChars.push(ch)
        if (buf.trim()) { words.push(buf.trim()); buf = '' }
      } else if (isSep(ch)) {
        if (buf.trim()) { words.push(buf.trim()); buf = '' }
      } else buf += ch
    }
    if (buf.trim()) words.push(buf.trim())
    for (let i = 0; i + 1 < cjkChars.length; i++) words.push(cjkChars[i] + cjkChars[i + 1])
    const tokens = [...new Set(words)].filter((t) => t.length >= 2).slice(0, 6)
    if (tokens.length === 0) return []
    const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    // P2 契约修复：list({}) 取最旧 200 条，长会话（>200 条）会漏掉 throughSeq 前最新的历史；
    // 改用 messages.listBefore（DB 侧 seq desc 取最近 limit 条）扫描最近一段压缩前历史。
    const recentPool = await this.messages.listBefore(userId, conversationId, { seqLte: throughSeq, limit: 200 })
    return recentPool
      .filter((m) => m.status === 'completed' && new RegExp(pattern, 'i').test(m.content))
      .slice(-4)
      .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
  }
}
