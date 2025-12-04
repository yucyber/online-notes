type Handler = (e: KeyboardEvent) => void

export class HotkeysProvider {
  private handlers: Record<string, Handler> = {}

  register(key: string, handler: Handler) {
    this.handlers[key] = handler
  }

  attach() {
    const listener = (e: KeyboardEvent) => {
      const combo = `${e.ctrlKey || e.metaKey ? 'Ctrl+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.altKey ? 'Alt+' : ''}${e.key.toUpperCase()}`
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

