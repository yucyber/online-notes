type FormatReadableEditor = {
  isActive: (name: string, attrs?: Record<string, unknown>) => boolean
  getAttributes: (name: string) => Record<string, unknown>
}

export type EditorBlockType = 'paragraph' | `h${1 | 2 | 3 | 4 | 5 | 6}`

export type EditorFormatState = {
  block: EditorBlockType
  fontSize: string
  bold: boolean
  italic: boolean
  underline: boolean
  blockquote: boolean
  code: boolean
  orderedList: boolean
  bulletList: boolean
  taskList: boolean
  highlight: boolean
  sup: boolean
  sub: boolean
  textAlign: 'left' | 'center' | 'right' | 'justify'
}

export const DEFAULT_EDITOR_FORMAT_STATE: EditorFormatState = {
  block: 'paragraph',
  fontSize: '15',
  bold: false,
  italic: false,
  underline: false,
  blockquote: false,
  code: false,
  orderedList: false,
  bulletList: false,
  taskList: false,
  highlight: false,
  sup: false,
  sub: false,
  textAlign: 'left',
}

export function readEditorFormatState(editor: FormatReadableEditor): EditorFormatState {
  const headingLevel = ([1, 2, 3, 4, 5, 6] as const).find((level) => editor.isActive('heading', { level }))
  const rawFontSize = editor.getAttributes('textStyle').fontSize
  const fontSize = typeof rawFontSize === 'string' && rawFontSize ? rawFontSize.replace(/px$/, '') : '15'

  return {
    block: headingLevel ? `h${headingLevel}` : 'paragraph',
    fontSize,
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    blockquote: editor.isActive('blockquote'),
    code: editor.isActive('code'),
    orderedList: editor.isActive('orderedList'),
    bulletList: editor.isActive('bulletList'),
    taskList: editor.isActive('taskList'),
    highlight: editor.isActive('highlight'),
    sup: editor.isActive('superscript'),
    sub: editor.isActive('subscript'),
    textAlign: (editor.getAttributes('paragraph').textAlign as EditorFormatState['textAlign']) || 'left',
  }
}
