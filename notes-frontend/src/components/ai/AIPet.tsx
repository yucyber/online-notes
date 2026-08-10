'use client';

import React, { useState } from 'react';
import { Bot } from 'lucide-react';
import ChatWindow from './ChatWindow';

export default function AIPet() {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                aria-label="切换 AI 助手"
                title="打开 AI 助手"
                className="group fixed bottom-4 right-4 z-50 cursor-pointer sm:bottom-6 sm:right-6"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="relative">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg transition duration-200 group-hover:-translate-y-0.5 group-hover:bg-blue-700 group-hover:shadow-xl sm:h-14 sm:w-14">
                        <Bot className="h-6 w-6 sm:h-7 sm:w-7" />
                    </div>
                    {/* Online Status Indicator */}
                    <span className="absolute top-0 right-0 flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500 border-2 border-white dark:border-gray-900"></span>
                    </span>
                </div>
            </button>
            <ChatWindow isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </>
    );
}
