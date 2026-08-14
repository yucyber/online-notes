import type { SVGProps } from 'react'

export type PrototypeGlyphName = 'search' | 'filter' | 'save' | 'close' | 'back' | 'chevron-left' | 'chevron-right' | 'chevron-down' | 'file' | 'comment' | 'users' | 'settings' | 'bold' | 'italic' | 'underline' | 'heading' | 'list' | 'ordered-list' | 'tasks' | 'quote' | 'code' | 'plus' | 'link' | 'image' | 'table' | 'unlink' | 'undo' | 'redo' | 'maximize' | 'minimize' | 'edit' | 'eye' | 'eye-off' | 'trash' | 'copy' | 'sparkle' | 'pen' | 'more' | 'align-left' | 'align-center' | 'align-right' | 'highlight' | 'superscript' | 'subscript'

export function PrototypeGlyph({ name, ...props }: SVGProps<SVGSVGElement> & { name: PrototypeGlyphName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {name === 'search' && <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>}
    {name === 'filter' && <path d="M4 5h16l-6 7v5l-4 2v-7z"/>}
    {name === 'save' && <><path d="M5 3h12l2 2v16H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></>}
    {name === 'close' && <path d="m6 6 12 12M18 6 6 18"/>}
    {name === 'back' && <path d="m15 18-6-6 6-6M9 12h11"/>}
    {name === 'chevron-left' && <path d="m15 18-6-6 6-6"/>}
    {name === 'chevron-right' && <path d="m9 18 6-6-6-6"/>}
    {name === 'chevron-down' && <path d="m6 9 6 6 6-6"/>}
    {name === 'file' && <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></>}
    {name === 'comment' && <path d="M4 4h16v13H8l-4 4z"/>}
    {name === 'users' && <><circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 2-6 6-6s6 2 6 6M16 5a3 3 0 0 1 0 6M17 14c3 .4 4 2.4 4 6"/></>}
    {name === 'settings' && <><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A7 7 0 0 0 15 6l-.3-2.6h-4L10.4 6a7 7 0 0 0-1.5.9l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2.2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.5.9l.3 2.6h4l.3-2.6a7 7 0 0 0 1.5-.9l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z"/></>}
    {name === 'bold' && <path d="M7 4h6a4 4 0 0 1 0 8H7zm0 8h7a4 4 0 0 1 0 8H7z"/>}
    {name === 'italic' && <path d="M10 4h8M6 20h8M14 4l-4 16"/>}
    {name === 'underline' && <><path d="M6 4v7a6 6 0 0 0 12 0V4M5 21h14"/></>}
    {name === 'heading' && <><path d="M5 5v14M15 5v14M5 12h10M18 10l2-2v11"/></>}
    {name === 'list' && <><path d="M9 6h11M9 12h11M9 18h11M4 6h.1M4 12h.1M4 18h.1"/></>}
    {name === 'ordered-list' && <><path d="M10 6h10M10 12h10M10 18h10M4 5h1v3M4 11h2l-2 3h2M4 17h2v3H4"/></>}
    {name === 'tasks' && <><path d="m3 6 2 2 3-4M11 6h10M3 13h5M11 13h10M3 20h5M11 20h10"/></>}
    {name === 'quote' && <path d="M7 10h4v8H5v-6a6 6 0 0 1 6-6M17 10h4v8h-6v-6a6 6 0 0 1 6-6"/>}
    {name === 'code' && <path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/>}
    {name === 'plus' && <path d="M12 5v14M5 12h14"/>}
    {name === 'link' && <path d="M10 13a5 5 0 0 0 7 .1l2-2A5 5 0 0 0 12 4l-1 1M14 11a5 5 0 0 0-7-.1l-2 2A5 5 0 0 0 12 20l1-1"/>}
    {name === 'image' && <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 20"/></>}
    {name === 'table' && <><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M9 4v16M15 4v16"/></>}
    {name === 'unlink' && <><path d="m9 15-2 2a4 4 0 0 1-6-6l2-2M15 9l2-2a4 4 0 0 1 6 6l-2 2M8 2v3M2 8h3M16 22v-3M22 16h-3"/></>}
    {name === 'undo' && <><path d="M9 7 4 12l5 5M20 17a8 8 0 0 0-11-7l-5 2"/></>}
    {name === 'redo' && <><path d="m15 7 5 5-5 5M4 17a8 8 0 0 1 11-7l5 2"/></>}
    {name === 'maximize' && <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>}
    {name === 'minimize' && <path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/>}
    {name === 'edit' && <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>}
    {name === 'eye' && <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>}
    {name === 'eye-off' && <><path d="m3 3 18 18M10.6 5.2A9 9 0 0 1 12 5c6 0 10 7 10 7a16 16 0 0 1-2.1 2.9M6.6 6.6C3.8 8.5 2 12 2 12s4 7 10 7a9 9 0 0 0 5.4-1.8M9.9 9.9a3 3 0 0 0 4.2 4.2"/></>}
    {name === 'trash' && <path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>}
    {name === 'copy' && <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>}
    {name === 'sparkle' && <><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5zM19 16v5M16.5 18.5h5"/></>}
    {name === 'pen' && <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>}
    {name === 'more' && <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></>}
    {name === 'align-left' && <><path d="M4 7h16M4 12h11M4 17h16"/></>}
    {name === 'align-center' && <><path d="M4 7h16M7 12h10M4 17h16"/></>}
    {name === 'align-right' && <><path d="M4 7h16M9 12h11M4 17h16"/></>}
    {name === 'highlight' && <><path d="M5 20l4-12 8 8-12 4z"/><path d="M14 9l4 4"/></>}
    {name === 'superscript' && <><path d="M9 18V8l5 10V8M17 7h6M20 4v6"/></>}
    {name === 'subscript' && <><path d="M9 18V8l5 10V8M17 21h6M20 18v6"/></>}
  </svg>
}
