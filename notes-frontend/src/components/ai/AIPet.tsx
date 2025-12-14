'use client';

import React, { useState } from 'react';
import { Bot } from 'lucide-react';
import ChatWindow from './ChatWindow';

export default function AIPet() {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <div
                className="fixed bottom-6 right-6 z-50 cursor-pointer group"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="relative">
                    <div className="w-14 h-14 bg-blue-600 hover:bg-blue-700 rounded-full shadow-lg flex items-center justify-center text-white transition-transform transform group-hover:scale-110 group-hover:-translate-y-1 duration-300">
                        <Bot size={32} />
                    </div>
                    {/* Online Status Indicator */}
                    <span className="absolute top-0 right-0 flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500 border-2 border-white dark:border-gray-900"></span>
                    </span>
                </div>
            </div>
            <ChatWindow isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </>
    );
}
