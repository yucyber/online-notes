export class NoteDerivedScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly quietMs = 10_000) {}

  schedule(noteId: string, task: () => Promise<void>): void {
    const pending = this.timers.get(noteId)
    if (pending) clearTimeout(pending)

    // 自动保存会高频写入；按 note 合并任务，避免每个 400ms 保存都调用 AI 和 embedding。
    const timer = setTimeout(() => {
      this.timers.delete(noteId)
      void task()
    }, this.quietMs)
    timer.unref?.()
    this.timers.set(noteId, timer)
  }

  cancel(noteId: string): void {
    const pending = this.timers.get(noteId)
    if (!pending) return
    clearTimeout(pending)
    this.timers.delete(noteId)
  }
}
