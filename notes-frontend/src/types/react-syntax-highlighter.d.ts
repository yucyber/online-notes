'use client'

declare module 'react-syntax-highlighter' {
  import * as React from 'react'
  export interface SyntaxHighlighterProps extends React.HTMLAttributes<HTMLElement> {
    language?: string
    style?: any
    PreTag?: keyof JSX.IntrinsicElements
  }
  export const Prism: React.ComponentType<SyntaxHighlighterProps>
  export const PrismLight: React.ComponentType<SyntaxHighlighterProps>
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  export const dracula: any
}
