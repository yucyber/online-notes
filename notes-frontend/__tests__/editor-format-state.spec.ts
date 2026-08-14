import { DEFAULT_EDITOR_FORMAT_STATE, readEditorFormatState } from '@/components/editor/editor-format-state'

describe('editor format state', () => {
  test('reads heading, font size, marks and list state at the selection', () => {
    const active = new Set(['heading:2', 'bold', 'orderedList'])
    const editor = {
      isActive: (name: string, attrs?: { level?: number }) => active.has(attrs?.level ? `${name}:${attrs.level}` : name),
      getAttributes: () => ({ fontSize: '18px' }),
    }

    expect(readEditorFormatState(editor)).toEqual({
      ...DEFAULT_EDITOR_FORMAT_STATE,
      block: 'h2',
      fontSize: '18',
      bold: true,
      orderedList: true,
    })
  })

  test('falls back to paragraph and default font size', () => {
    const editor = {
      isActive: () => false,
      getAttributes: () => ({}),
    }

    expect(readEditorFormatState(editor)).toEqual(DEFAULT_EDITOR_FORMAT_STATE)
  })
})
