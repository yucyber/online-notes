'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { appToast } from '@/lib/app-toast';

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

interface ChatWindowProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function ChatWindow({ isOpen, onClose }: ChatWindowProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [conversationId, setConversationId] = useState<string>('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const saved = localStorage.getItem('ai_pet_history');
        const savedId = localStorage.getItem('ai_pet_conversation_id');
        if (saved) {
            try {
                const parsed = JSON.parse(saved) as Message[];
                setMessages(
                    Array.isArray(parsed)
                        ? parsed.map((msg) => ({ role: msg.role, content: String(msg.content || '') }))
                        : [],
                );
            } catch (e) {
                console.error('Failed to parse chat history', e);
            }
        }
        if (savedId) {
            setConversationId(savedId);
        }
    }, []);

    useEffect(() => {
        localStorage.setItem('ai_pet_history', JSON.stringify(messages));
        if (conversationId) {
            localStorage.setItem('ai_pet_conversation_id', conversationId);
        }
    }, [messages, conversationId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleClearHistory = () => {
        setMessages([]);
        setConversationId('');
        localStorage.removeItem('ai_pet_history');
        localStorage.removeItem('ai_pet_conversation_id');
    };

    const generateReply = async (userMsg: Message, appendUserMessage: boolean) => {
        if (appendUserMessage) setMessages((prev) => [...prev, userMsg]);
        setIsLoading(true);

        try {
            const response = await fetch('/api/ai/pet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMsg.content,
                    conversationId: conversationId || undefined,
                }),
            });

            if (!response.ok) {
                let errorMessage = 'Failed to send message';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                } catch {
                    const text = await response.text();
                    if (text) errorMessage = text;
                }
                throw new Error(errorMessage);
            }

            if (!response.body) throw new Error('No response body');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let assistantMessage = '';
            let isFirstChunk = true;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                if (!chunk) continue;

                assistantMessage += chunk;

                if (isFirstChunk) {
                    isFirstChunk = false;
                    setMessages((prev) => [...prev, { role: 'assistant', content: assistantMessage }]);
                } else {
                    setMessages((prev) => {
                        const newMessages = [...prev];
                        const lastMsg = newMessages[newMessages.length - 1];
                        if (lastMsg.role === 'assistant') {
                            lastMsg.content = assistantMessage;
                        }
                        return newMessages;
                    });
                }
            }
            appToast.dismiss('ai-pet:request');
        } catch (error) {
            console.error('Chat error:', error);
            setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: 'AI 生成失败，请稍后重试。' },
            ]);
            appToast.error({
                id: 'ai-pet:request',
                title: 'AI 生成失败',
                message: '请检查网络后重试。',
                action: { label: '重试生成', onClick: () => { void generateReply(userMsg, false); } },
                persistent: true,
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSend = () => {
        const content = input.trim();
        if (!content || isLoading) return;

        setInput('');
        void generateReply({ role: 'user', content }, true);
    };

    if (!isOpen) return null;

    return (
        <aside className="ink-panel-real" aria-label="墨点助手">
            <div className="ink-head-real">
                <div><h3>墨点助手</h3><p>搜索全部笔记</p></div>
                <div className="ink-head-actions">
                    <button type="button" onClick={handleClearHistory} title="清空对话">清空</button>
                    <button type="button" onClick={onClose} aria-label="关闭墨点助手">×</button>
                </div>
            </div>

            <div className="ink-body-real">
                {messages.length === 0 && (
                    <div className="text-[var(--product-text-secondary)]">
                        <p className="leading-6">把零散想法变成清晰的下一步。你可以从这些常用操作开始：</p>
                        <div className="mt-4 grid gap-2">
                            {['总结当前笔记', '从笔记中提取待办', '搜索我的知识库'].map((action) => <button key={action} className="rounded-[8px] border border-[var(--product-line)] px-3 py-2.5 text-left text-sm hover:bg-[var(--product-panel-soft)]" onClick={() => setInput(action)}>{action}</button>)}
                        </div>
                    </div>
                )}
                {messages.map((msg, idx) => (
                    <div key={idx} className={`ink-message-real ${msg.role}`}>
                        <div>
                            <div className="prose dark:prose-invert max-w-none text-sm">
                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>
                        </div>
                    </div>
                ))}
                {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
                    <div className="ink-message-real assistant">
                        <div>
                            <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="ink-compose-real">
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder="问问墨点…"
                    />
                    <button type="button" onClick={handleSend} disabled={isLoading || !input.trim()} aria-label="发送">↑</button>
            </div>
        </aside>
    );
}
