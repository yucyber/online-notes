import { Node, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    statusPill: {
      insertStatusPill: (attrs: { label?: string; variant?: 'inprogress' | 'done' | 'blocker'; color?: string }) => ReturnType
      setStatusVariant: (variant: 'inprogress' | 'done' | 'blocker') => ReturnType
    }
  }
}

const StatusPill = Node.create({
  name: 'statusPill',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      label: { default: '状态：进行中' },
      variant: { default: 'inprogress' },
      color: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span.status-pill',
        getAttrs: (el) => {
          const node = el as HTMLElement
          return {
            label: node.textContent || '状态：进行中',
            variant: node.getAttribute('data-variant') || 'inprogress',
            color: node.style.backgroundColor || null,
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const { label, variant } = HTMLAttributes as any
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: `status-pill ${variant}`,
        'data-variant': variant,
        'aria-label': label,
        'aria-roledescription': '状态标签',
        contenteditable: 'false',
      }),
      label,
    ]
  },

  addCommands() {
    return {
      insertStatusPill:
        (attrs) =>
        ({ commands }) => commands.insertContent({ type: this.name, attrs: { ...attrs } }),
      setStatusVariant:
        (variant) =>
        ({ commands }) => commands.updateAttributes(this.name, { variant }),
    }
  },
})

export default StatusPill
