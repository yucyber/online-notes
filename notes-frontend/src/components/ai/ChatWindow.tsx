'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { appToast } from '@/lib/app-toast';
import { getRagAnswer, type RagAnswer } from '@/lib/ai-client';
import RagCitationList from './RagCitationList';

interface Message {
    role: 'user' | 'assistant';
    content: string;
}
interface RagMessage extends Message { result?: RagAnswer }

interface ChatWindowProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function ChatWindow({ isOpen, onClose }: ChatWindowProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [ragMessages, setRagMessages] = useState<RagMessage[]>([]);
    const [mode, setMode] = useState<'pet' | 'rag'>('pet');
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const saved = localStorage.getItem('ai_pet_history');
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
    }, []);

    useEffect(() => {
        const saved = localStorage.getItem('ai_rag_history');
        if (!saved) return;
        try {
            const parsed = JSON.parse(saved) as RagMessage[];
            if (Array.isArray(parsed)) setRagMessages(parsed.map((msg) => ({ role: msg.role, content: String(msg.content || ''), result: msg.result })));
        } catch { localStorage.removeItem('ai_rag_history'); }
    }, []);

    useEffect(() => {
        localStorage.setItem('ai_pet_history', JSON.stringify(messages));
    }, [messages]);
    useEffect(() => { localStorage.setItem('ai_rag_history', JSON.stringify(ragMessages)); }, [ragMessages]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, ragMessages, mode]);

    const handleClearHistory = () => {
        if (mode === 'pet') { setMessages([]); localStorage.removeItem('ai_pet_history'); }
        else { setRagMessages([]); localStorage.removeItem('ai_rag_history'); }
    };

    const generateRagReply = async (content: string) => {
        setRagMessages((prev) => [...prev, { role: 'user', content }]);
        setIsLoading(true);
        try {
            const result = await getRagAnswer(content);
            setRagMessages((prev) => [...prev, { role: 'assistant', content: result.answer, result }]);
            appToast.dismiss('ai-rag:request');
        } catch {
            setRagMessages((prev) => [...prev, { role: 'assistant', content: '知识助手暂时不可用，请稍后重试。' }]);
            appToast.error({ id: 'ai-rag:request', title: '知识助手请求失败', message: '请检查网络后重试。', persistent: true });
        } finally { setIsLoading(false); }
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
        if (mode === 'pet') void generateReply({ role: 'user', content }, true);
        else void generateRagReply(content);
    };

    if (!isOpen) return null;

    return (
        <aside className="ink-panel-real" aria-label="墨点助手">
            <div className="ink-head-real">
                <div><h3>{mode === 'pet' ? '墨点助手' : '知识助手'}</h3><p>{mode === 'pet' ? '轻松聊聊' : '只读检索你的笔记'}</p></div>
                <div className="ink-head-actions">
                    <button type="button" onClick={handleClearHistory} title="清空对话">清空</button>
                    <button type="button" onClick={onClose} aria-label="关闭墨点助手">×</button>
                </div>
            </div>

            <div className="flex gap-2 border-b border-[var(--product-line)] px-3 py-2 text-sm">
                <button type="button" className={mode === 'pet' ? 'font-medium' : 'text-[var(--product-text-secondary)]'} onClick={() => setMode('pet')}>宠物聊天</button>
                <button type="button" className={mode === 'rag' ? 'font-medium' : 'text-[var(--product-text-secondary)]'} onClick={() => setMode('rag')}>知识助手</button>
            </div>

            <div className="ink-body-real">
                {mode === 'pet' && messages.length === 0 && (
                    <div className="text-[var(--product-text-secondary)]">
                        <p className="leading-6">把零散想法变成清晰的下一步。你可以从这些常用操作开始：</p>
                        <div className="mt-4 grid gap-2">
                            {['总结当前笔记', '从笔记中提取待办', '搜索我的知识库'].map((action) => <button key={action} className="rounded-[8px] border border-[var(--product-line)] px-3 py-2.5 text-left text-sm hover:bg-[var(--product-panel-soft)]" onClick={() => setInput(action)}>{action}</button>)}
                        </div>
                    </div>
                )}
                {mode === 'pet' && messages.map((msg, idx) => (
                    <div key={idx} className={`ink-message-real ${msg.role}`}>
                        <div>
                            <div className="prose dark:prose-invert max-w-none text-sm">
                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>
                        </div>
                    </div>
                ))}
                {mode === 'rag' && ragMessages.length === 0 && <p className="text-sm leading-6 text-[var(--product-text-secondary)]">向知识助手提问。它只会引用当前有权限访问的笔记；找不到记录时会明确说明。</p>}
                {mode === 'rag' && ragMessages.map((msg, idx) => (
                    <div key={idx} className={`ink-message-real ${msg.role}`}><div><div className="prose dark:prose-invert max-w-none text-sm"><ReactMarkdown>{msg.content}</ReactMarkdown></div>{msg.result && <RagCitationList citations={msg.result.citations} />}{msg.result?.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-[var(--product-text-secondary)]">{warning}</p>)}</div></div>
                ))}
                {isLoading && ((mode === 'pet' && messages[messages.length - 1]?.role !== 'assistant') || mode === 'rag') && (
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
                        placeholder={mode === 'pet' ? '问问墨点…' : '问问你的笔记…'}
                    />
                    <button type="button" onClick={handleSend} disabled={isLoading || !input.trim()} aria-label="发送">↑</button>
            </div>
        </aside>
    );
}
