import { FileText, Loader2, PenTool, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { streamAIWriter } from '@/lib/ai-writer'

type Props = {
  editor: any
  readOnly: boolean
  aiWritingType: null | 'continue' | 'polish' | 'summary'
  setAiWritingType: (type: null | 'continue' | 'polish' | 'summary') => void
  mode: 'continue' | 'selection' | 'bubble'
}

export function TiptapAiActions({ editor, readOnly, aiWritingType, setAiWritingType, mode }: Props) {
  if (mode === 'continue') {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="flex items-center gap-1 bg-white shadow-md border"
        disabled={!!aiWritingType || readOnly}
        onClick={() => {
          if (!editor) return
          const { from } = editor.state.selection
          const context = editor.state.doc.textBetween(Math.max(0, from - 500), from, '\n')
          setAiWritingType('continue')
          streamAIWriter({
            context,
            type: 'continue',
            onChunk: (text) => editor.chain().focus().insertContent(text).run(),
            onDone: () => setAiWritingType(null),
            onError: () => setAiWritingType(null),
          })
        }}
      >
        {aiWritingType === 'continue' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenTool className="w-4 h-4" />}
        AI 续写
      </Button>
    )
  }

  const runContinue = () => {
    if (!editor) return
    const { from } = editor.state.selection
    const context = editor.state.doc.textBetween(Math.max(0, from - 500), from, '\n')
    setAiWritingType('continue')
    streamAIWriter({
      context,
      type: 'continue',
      onChunk: (text) => editor.chain().focus().insertContent(text).run(),
      onDone: () => setAiWritingType(null),
      onError: () => setAiWritingType(null),
    })
  }

  return (
    <>
      {mode === 'bubble' && (
        <Button
          aria-label="AI 续写"
          title="AI 续写"
          size="icon"
          variant="ghost"
          disabled={readOnly || !!aiWritingType}
          onClick={runContinue}
        >
          {aiWritingType === 'continue' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenTool className="w-4 h-4" />}
        </Button>
      )}
      <Button
        aria-label={"AI 润色"}
        title={"AI 润色"}
        size="icon"
        variant="ghost"
        disabled={readOnly || !!aiWritingType}
        onClick={() => {
          const { from, to } = editor.state.selection
          const context = editor.state.doc.textBetween(from, to, '\n')
          setAiWritingType('polish')
          let isFirstChunk = true
          streamAIWriter({
            context,
            type: 'polish',
            onChunk: (text) => {
              if (isFirstChunk) {
                editor.chain().focus().deleteSelection().insertContent(text).run()
                isFirstChunk = false
              } else editor.chain().focus().insertContent(text).run()
            },
            onDone: () => setAiWritingType(null),
            onError: () => setAiWritingType(null),
          })
        }}
      >
        {aiWritingType === 'polish' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-purple-500" />}
      </Button>
      <Button
        aria-label={"AI 摘要"}
        title={"生成摘要"}
        size="icon"
        variant="ghost"
        disabled={readOnly || !!aiWritingType}
        onClick={() => {
          const { from, to } = editor.state.selection
          const context = editor.state.doc.textBetween(from, to, '\n')
          setAiWritingType('summary')
          editor.chain().focus().setTextSelection(to).insertContent('\n\n> **摘要**：').run()
          streamAIWriter({
            context,
            type: 'summary',
            onChunk: (text) => editor.chain().focus().insertContent(text).run(),
            onDone: () => {
              editor.chain().focus().insertContent('\n\n').run()
              setAiWritingType(null)
            },
            onError: () => setAiWritingType(null),
          })
        }}
      >
        {aiWritingType === 'summary' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4 text-blue-500" />}
      </Button>
    </>
  )
}
