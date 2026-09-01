'use client';

import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { appToast } from '@/lib/app-toast';
import { getRagAnswer } from '@/lib/ai-client';
import { AssistantMessage, ASSISTANT_HISTORY_KEY, loadAssistantHistory, routeAssistantMessage, saveAssistantHistory } from './assistant-history';
import RagCitationList from './RagCitationList';

interface ChatWindowProps { isOpen: boolean; onClose: () => void }

function messageId() {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createMessage(role: AssistantMessage['role'], content: string, route: AssistantMessage['route'], result?: AssistantMessage['result']): AssistantMessage {
    return { id: messageId(), role, content, route, ...(result ? { result } : {}), createdAt: new Date().toISOString() };
}

export default function ChatWindow({ isOpen, onClose }: ChatWindowProps) {
    const [messages, setMessages] = useState<AssistantMessage[]>([]);
    const [hydrated, setHydrated] = useState(false);
    const [forceNotes, setForceNotes] = useState(false);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setMessages(loadAssistantHistory(localStorage));
        setHydrated(true);
    }, []);

    useEffect(() => {
        if (hydrated) saveAssistantHistory(localStorage, messages);
    }, [hydrated, messages]);

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isLoading]);

    const handleClearHistory = () => {
        setMessages([]);
        localStorage.removeItem(ASSISTANT_HISTORY_KEY);
        localStorage.removeItem('ai_pet_history');
        localStorage.removeItem('ai_rag_history');
    };

    const generateRagReply = async (content: string) => {
        try {
            const result = await getRagAnswer(content);
            setMessages((prev) => [...prev, createMessage('assistant', result.answer, 'rag', result)]);
            appToast.dismiss('ai-rag:request');
        } catch {
            setMessages((prev) => [...prev, createMessage('assistant', '知识检索暂时不可用，请稍后重试。', 'rag')]);
            appToast.error({ id: 'ai-rag:request', title: '知识检索失败', message: '请检查网络后重试。', persistent: true });
        }
    };

    const generatePetReply = async (content: string) => {
        const assistantId = messageId();
        try {
            const response = await fetch('/api/ai/pet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: content }) });
            if (!response.ok || !response.body) throw new Error('Pet chat request failed');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let answer = '';
            let appended = false;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                answer += decoder.decode(value, { stream: true });
                if (!answer) continue;
                if (!appended) {
                    appended = true;
                    setMessages((prev) => [...prev, { ...createMessage('assistant', answer, 'pet'), id: assistantId }]);
                } else {
                    setMessages((prev) => prev.map((message) => message.id === assistantId ? { ...message, content: answer } : message));
                }
            }
            appToast.dismiss('ai-pet:request');
        } catch (error) {
            console.error('Chat error:', error);
            setMessages((prev) => [...prev, createMessage('assistant', '小助手暂时没有回应，请稍后重试。', 'pet')]);
            appToast.error({ id: 'ai-pet:request', title: '小助手请求失败', message: '请检查网络后重试。', persistent: true });
        }
    };

    const handleSend = () => {
        const content = input.trim();
        if (!content || isLoading) return;
        const route = routeAssistantMessage(content, forceNotes);
        setInput('');
        setMessages((prev) => [...prev, createMessage('user', content, route)]);
        setIsLoading(true);
        const request = route === 'rag' ? generateRagReply(content) : generatePetReply(content);
        void request.finally(() => setIsLoading(false));
    };

    if (!isOpen) return null;
    return (
        <aside className="ink-panel-real" aria-label="小助手">
            <div className="ink-head-real">
                <div className="ink-head-title"><span className="ink-head-mark"><Sparkles aria-hidden="true" /></span><div><h3>小助手</h3><p>闲聊，或从你的笔记中寻找答案</p></div></div>
                <div className="ink-head-actions"><button type="button" onClick={handleClearHistory} title="清空对话">清空</button><button type="button" onClick={onClose} aria-label="关闭小助手">×</button></div>
            </div>
            <div className="ink-body-real">
                {messages.length === 0 && <div className="ink-empty-real"><span><Sparkles aria-hidden="true" /></span><h4>今天想聊点什么？</h4><p>直接聊天，或让我从你有权限访问的笔记里寻找依据。</p><div>{['帮我理清今天的想法', '找找我之前踩过的坑'].map((action) => <button key={action} type="button" onClick={() => setInput(action)}>{action}</button>)}</div></div>}
                {messages.map((message) => <div key={message.id} className={`ink-message-real ${message.role}`}>
                    {message.role === 'assistant' && <div className={`ink-message-source ${message.route}`}>{message.route === 'rag' ? <BookOpen aria-hidden="true" /> : <Sparkles aria-hidden="true" />}{message.route === 'rag' ? '基于你的笔记' : '轻松聊聊'}</div>}
                    <div className="prose dark:prose-invert max-w-none text-sm"><ReactMarkdown>{message.content}</ReactMarkdown></div>
                    {message.result && <RagCitationList citations={message.result.citations} />}
                    {message.result?.warnings.map((warning) => <p key={warning} className="ink-message-warning">{warning}</p>)}
                </div>)}
                {isLoading && <div className="ink-message-real assistant ink-loading-real"><Loader2 aria-label="小助手正在回复" /></div>}
                <div ref={messagesEndRef} />
            </div>
            <div className="ink-compose-wrap">
                <button type="button" className="ink-note-toggle" aria-pressed={forceNotes} onClick={() => setForceNotes((current) => !current)}><BookOpen aria-hidden="true" />搜索笔记</button>
                <div className="ink-compose-real">
                    <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSend(); } }} placeholder="问问小助手…" />
                    <button type="button" onClick={handleSend} disabled={isLoading || !input.trim()} aria-label="发送">↑</button>
                </div>
            </div>
        </aside>
    );
}
