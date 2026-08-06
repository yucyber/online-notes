import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import TextAlign from '@tiptap/extension-text-align'
import Color from '@tiptap/extension-color'
import TextStyle from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import ListItem from '@tiptap/extension-list-item'
import Heading from '@tiptap/extension-heading'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import CommentMark from './extensions/CommentMark'
import FontSize from './extensions/FontSize'
import StatusPill from './extensions/StatusPill'
import ResourceEmbed from './extensions/ResourceEmbed'
import { colorFromString, hexToRgb, srgb } from './tiptap-utils'

export function createTiptapExtensions(opts: {
  collabEnabled: boolean
  ydoc: Y.Doc
  provider: WebsocketProvider | null
  user: { id: string; name: string; avatar?: string }
}) {
  const { collabEnabled, ydoc, provider, user } = opts

  return [
    StarterKit.configure({ history: false, heading: false, listItem: false, horizontalRule: false }),
    Underline,
    Link.configure({ autolink: true, openOnClick: true, HTMLAttributes: { rel: 'noopener noreferrer' } }),
    Image.configure({ inline: false }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    HorizontalRule,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    FontSize,
    TextStyle,
    StatusPill,
    ResourceEmbed,
    Color,
    Highlight,
    Subscript,
    Superscript,
    TaskList,
    TaskItem,
    ListItem,
    Heading,
    Placeholder.configure({ placeholder: '开始写作…' }),
    CommentMark,
    ...(collabEnabled
      ? [
          Collaboration.configure({ document: ydoc }),
          ...(provider
            ? [
                CollaborationCursor.configure({
                  provider: provider as any,
                  user: { ...user, color: colorFromString(user.name || user.id || 'user') },
                  render: (u) => {
                    const color = u.color || colorFromString(u.name || u.id || 'user')
                    const el = document.createElement('span')
                    el.className = 'rounded px-1 text-xs'
                    el.style.backgroundColor = color
                    const { r, g, b } = hexToRgb(color)
                    const lum = 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
                    el.style.color = lum > 0.5 ? '#111827' : '#FFFFFF'
                    el.style.boxShadow = 'inset 0 0 0 1px rgba(0,0,0,0.15)'
                    el.textContent = u.name || '用户'
                    el.setAttribute('aria-hidden', 'true')
                    el.setAttribute('role', 'presentation')
                    return el
                  },
                }),
              ]
            : []),
        ]
      : []),
  ]
}
