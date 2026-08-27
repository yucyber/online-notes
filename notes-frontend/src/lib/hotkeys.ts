type Handler = (e: KeyboardEvent) => void

export class HotkeysProvider {
  private handlers: Record<string, Handler> = {}

  register(key: string, handler: Handler) {
    this.handlers[key] = handler
  }

  attach() {
    const listener = (e: KeyboardEvent) => {
      // IME 输入中和某些合成 keystroke 的 e.key 可能是 undefined/空字符串，String 兜底避免 toUpperCase 抛错阻断后续快捷键
      const keyName = String(e.key || '')
      if (!keyName) return
      const combo = `${e.ctrlKey || e.metaKey ? 'Ctrl+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.altKey ? 'Alt+' : ''}${keyName.toUpperCase()}`
      const mapped: Record<string, string> = {
        'Ctrl+K': 'Ctrl+K',
        'Ctrl+N': 'Ctrl+N',
        'Ctrl+P': 'Ctrl+P',
        'Ctrl+S': 'Ctrl+S',
        'META+S': 'Ctrl+S',
      }
      const key = mapped[combo] || combo
      const fn = this.handlers[key]
      if (fn) {
        e.preventDefault()
        fn(e)
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }
}

export const globalHotkeys = new HotkeysProvider()

