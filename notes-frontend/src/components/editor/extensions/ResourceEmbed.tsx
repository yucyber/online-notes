import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import React, { useState } from 'react'
import { Eye, Link as LinkIcon, ExternalLink } from 'lucide-react'
import { Plugin } from 'prosemirror-state'

const ResourceComponent = ({ node, updateAttributes }: any) => {
    const { type, id, displayMode } = node.attrs
    const [iframeError, setIframeError] = useState(false)

    const toggleMode = () => {
        updateAttributes({
            displayMode: displayMode === 'link' ? 'preview' : 'link'
        })
    }

    const url = `/dashboard/${type}s/${id}`
    const previewUrl = type === 'mindmap'
        ? `/embed/mindmaps/${id}?readonly=true`
        : `/dashboard/boards/${id}/embed?readonly=true`
    const label = type === 'mindmap' ? '思维导图' : '画板'

    return (
        <NodeViewWrapper className="resource-embed my-4 select-none" contentEditable={false}>
            <div className={`border rounded-lg overflow-hidden bg-white shadow-sm transition-all ${displayMode === 'preview' ? 'h-[500px]' : ''}`}>
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b">
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                        <span className="text-lg">{type === 'mindmap' ? '🧠' : '🎨'}</span>
                        <span className="font-medium">{label}</span>
                        <span className="text-gray-400 text-xs font-mono bg-gray-100 px-1 rounded">{String(id).slice(0, 8)}...</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={toggleMode}
                            className="p-1.5 hover:bg-white hover:shadow-sm rounded text-gray-600 transition-all"
                            title={displayMode === 'link' ? "切换预览" : "切换链接"}
                        >
                            {displayMode === 'link' ? <Eye size={16} /> : <LinkIcon size={16} />}
                        </button>
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 hover:bg-white hover:shadow-sm rounded text-gray-600 transition-all"
                            title="在新标签页打开"
                        >
                            <ExternalLink size={16} />
                        </a>
                    </div>
                </div>

                {displayMode === 'link' ? (
                    <div className="p-4 bg-white flex items-center">
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline flex items-center gap-2 text-sm"
                        >
                            <LinkIcon size={14} />
                            {window.location.origin}{url}
                        </a>
                    </div>
                ) : (
                    <div className="w-full h-[calc(100%-41px)] bg-gray-100 relative">
                        {iframeError ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 text-sm gap-2">
                                <span>预览加载失败</span>
                                <a href={url} target="_blank" className="text-blue-500 hover:underline">直接访问</a>
                            </div>
                        ) : (
                            <iframe
                                src={previewUrl}
                                className="w-full h-full border-0"
                                onError={() => setIframeError(true)}
                                loading="lazy"
                                title={`${label} Preview`}
                                sandbox="allow-scripts allow-same-origin"
                            />
                        )}
                    </div>
                )}
            </div>
        </NodeViewWrapper>
    )
}

export default Node.create({
    name: 'resourceEmbed',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,
    isolating: true,

    addAttributes() {
        return {
            type: { default: 'mindmap' },
            id: { default: null },
            displayMode: {
                default: 'link',
                parseHTML: element => element.getAttribute('data-display-mode') || 'link',
                renderHTML: attributes => ({ 'data-display-mode': attributes.displayMode || 'link' }),
            },
        }
    },

    parseHTML() {
        return [{ tag: 'resource-embed' }]
    },

    renderHTML({ HTMLAttributes }) {
        return ['resource-embed', mergeAttributes({ contenteditable: 'false' }, HTMLAttributes)]
    },

    addNodeView() {
        return ReactNodeViewRenderer(ResourceComponent)
    },

    addProseMirrorPlugins() {
        return [
            new Plugin({
                props: {
                    handlePaste: (view, event) => {
                        const text = event.clipboardData?.getData('text/plain') || ''
                        const m = text.match(/(?:https?:\/\/[^\/]+)?\/dashboard\/(mindmaps|boards)\/([a-zA-Z0-9-]+)/)
                        if (m) {
                            const rawType = m[1]
                            const type = rawType === 'mindmaps' ? 'mindmap' : 'board'
                            const id = m[2]
                            const { tr } = view.state
                            const node = this.type.create({ type, id, displayMode: 'link' })
                            tr.replaceSelectionWith(node)
                            view.dispatch(tr.scrollIntoView())
                            return true
                        }
                        return false
                    }
                }
            })
        ]
    }
})

