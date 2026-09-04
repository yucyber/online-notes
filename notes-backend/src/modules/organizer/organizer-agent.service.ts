import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { ConfigService } from '@nestjs/config'
import { User, UserDocument } from '../users/schemas/user.schema'
import { OrganizerPlanningService } from './organizer-planning.service'
import { OrganizerProposalService } from './organizer-proposal.service'

const DEFAULT_INTERVAL_MINUTES = 1440
const MIN_INTERVAL_MINUTES = 60

/**
 * 小助手整理代理：周期性为用户生成全局整理提案。
 * 只产出 pending 提案，绝不执行任何写笔记动作；执行仍由用户在确认界面触发。
 */
@Injectable()
export class OrganizerAgentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrganizerAgentService.name)
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly planning: OrganizerPlanningService,
    private readonly proposals: OrganizerProposalService,
    @Optional() @InjectModel(User.name) private readonly userModel?: Model<UserDocument>,
    @Optional() private readonly config?: ConfigService,
  ) {}

  onModuleInit() {
    if (!this.isEnabled()) return
    const intervalMs = this.intervalMinutes() * 60 * 1000
    // unref：定时器不阻止进程退出，测试/脚本不受影响。
    this.timer = setInterval(() => {
      void this.runForAllUsers().catch((error) => this.logger.warn(`organizer agent tick failed: ${error?.message}`))
    }, intervalMs)
    if (typeof (this.timer as any).unref === 'function') (this.timer as any).unref()
    this.logger.log(`organizer agent enabled, interval ${this.intervalMinutes()} minutes`)
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  isEnabled(): boolean {
    return String(this.config?.get<string>('ORGANIZER_AGENT_ENABLED') || '').toLowerCase() === 'true'
  }

  intervalMinutes(): number {
    const raw = Number(this.config?.get<string>('ORGANIZER_AGENT_INTERVAL_MIN') || DEFAULT_INTERVAL_MINUTES)
    if (!Number.isFinite(raw)) return DEFAULT_INTERVAL_MINUTES
    return Math.max(MIN_INTERVAL_MINUTES, Math.floor(raw))
  }

  /** 为单个用户生成提案；已有 pending 提案时跳过，避免堆积重复建议。 */
  async runForUser(userId: string) {
    const existing = await this.proposals.findAll(userId)
    const pending = (existing || []).find((proposal: any) => proposal.status === 'pending')
    if (pending) {
      return { generated: false, reason: 'pending_exists' as const, proposal: pending }
    }
    return this.planning.createGlobalProposal(userId)
  }

  /** 定时任务入口：遍历用户逐个尝试生成，单个失败不影响其他用户。 */
  async runForAllUsers() {
    if (!this.userModel) return { users: 0, generated: 0 }
    const users = await this.userModel.find({}).select('_id').lean().exec()
    let generated = 0
    for (const user of users as Array<{ _id: any }>) {
      try {
        const result = await this.runForUser(String(user._id))
        if ((result as any)?.generated) generated += 1
      } catch (error: any) {
        this.logger.warn(`organizer agent failed for user ${String(user._id)}: ${error?.message}`)
      }
    }
    return { users: users.length, generated }
  }
}
