'use client';

import React, { useState } from 'react';
import ChatWindow from './ChatWindow';

export default function AIPet() {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                aria-label={isOpen ? '关闭墨点助手' : '打开墨点助手'}
                title={isOpen ? '关闭墨点助手' : '打开墨点助手'}
                className="fixed bottom-6 right-6 z-50 inline-flex h-[46px] w-[46px] items-center justify-center gap-[2px] whitespace-nowrap rounded-full border border-[var(--product-line-strong)] bg-[var(--product-brand)] font-serif text-xs font-bold text-[var(--product-panel)] shadow-[var(--product-shadow-float)] transition-transform duration-150 hover:-translate-y-0.5"
                onClick={() => setIsOpen(!isOpen)}
            >
                N <span className="text-[var(--product-accent)]">✦</span>
            </button>
            <ChatWindow isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </>
    );
}
