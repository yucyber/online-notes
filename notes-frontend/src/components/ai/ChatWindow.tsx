'use client';

import React, { useState, useRef, useEffect } from 'react';
import { X, Trash2, Image as ImageIcon, Send, Bot, User as UserIcon, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    image?: string; // Base64 or URL for display
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
    const [selectedImage, setSelectedImage] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Load history from localStorage
    useEffect(() => {
        const saved = localStorage.getItem('ai_pet_history');
        const savedId = localStorage.getItem('ai_pet_conversation_id');
        if (saved) {
            try {
                setMessages(JSON.parse(saved));
            } catch (e) {
                console.error('Failed to parse chat history', e);
            }
        }
        if (savedId) {
            setConversationId(savedId);
        }
    }, []);

    // Save history to localStorage
    useEffect(() => {
        localStorage.setItem('ai_pet_history', JSON.stringify(messages));
        if (conversationId) {
            localStorage.setItem('ai_pet_conversation_id', conversationId);
        }
    }, [messages, conversationId]);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleClearHistory = () => {
        setMessages([]);
        setConversationId('');
        localStorage.removeItem('ai_pet_history');
        localStorage.removeItem('ai_pet_conversation_id');
    };

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedImage(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setImagePreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const clearImage = () => {
        setSelectedImage(null);
        setImagePreview(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleSend = async () => {
        if ((!input.trim() && !selectedImage) || isLoading) return;

        const userMsg: Message = {
            role: 'user',
            content: input,
            image: imagePreview || undefined,
        };

        setMessages((prev) => [...prev, userMsg]);
        setInput('');
        clearImage();
        setIsLoading(true);

        try {
            const formData = new FormData();
            formData.append('message', userMsg.content);
            if (conversationId) {
                formData.append('conversationId', conversationId);
            }
            if (selectedImage) {
                formData.append('image', selectedImage);
            }

            const response = await fetch('/api/ai/pet', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                let errorMessage = 'Failed to send message';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                } catch (e) {
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

            // In a real implementation, we might get the conversationId back from the API
            // For now, we assume the API handles it or we generate one if needed.
            // If the API returns the conversationId in a header or specific event, we should capture it.
            // Since our stream is pure text content, we might need a different protocol to sync conversationId.
            // For this MVP, we'll rely on the backend maintaining it or the user session.

        } catch (error) {
            console.error('Chat error:', error);
            setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
            ]);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed bottom-24 right-6 w-96 h-[600px] bg-white dark:bg-gray-800 rounded-xl shadow-2xl flex flex-col border border-gray-200 dark:border-gray-700 z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-10 duration-300">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-primary/5">
                <div className="flex items-center gap-2">
                    <Bot className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold text-gray-800 dark:text-gray-100">AI 助手</h3>
                </div>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={handleClearHistory} title="Clear History">
                        <Trash2 className="w-4 h-4 text-gray-500 hover:text-red-500" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="w-4 h-4 text-gray-500" />
                    </Button>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-900/50">
                {messages.length === 0 && (
                    <div className="text-center text-gray-400 mt-20">
                        <Bot className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>有什么我可以帮你的吗？</p>
                    </div>
                )}
                {messages.map((msg, idx) => (
                    <div
                        key={idx}
                        className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                    >
                        <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'
                                }`}
                        >
                            {msg.role === 'user' ? <UserIcon size={16} /> : <Bot size={16} />}
                        </div>
                        <div
                            className={`max-w-[80%] rounded-lg p-3 text-sm ${msg.role === 'user'
                                ? 'bg-blue-600 text-white'
                                : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200'
                                }`}
                        >
                            {msg.image && msg.image.length > 0 && (
                                <img src={msg.image} alt="User upload" className="max-w-full rounded mb-2" />
                            )}
                            <div className="prose dark:prose-invert max-w-none text-sm">
                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>
                        </div>
                    </div>
                ))}
                {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
                    <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0">
                            <Bot size={16} />
                        </div>
                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                            <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                {imagePreview && (
                    <div className="relative inline-block mb-2">
                        <img src={imagePreview} alt="Preview" className="h-16 w-16 object-cover rounded border border-gray-300" />
                        <button
                            onClick={clearImage}
                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600"
                        >
                            <X size={12} />
                        </button>
                    </div>
                )}
                <div className="flex gap-2 items-end">
                    <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleImageSelect}
                    />
                    <Button
                        variant="outline"
                        size="icon"
                        className="flex-shrink-0"
                        onClick={() => fileInputRef.current?.click()}
                        title="Upload Image"
                    >
                        <ImageIcon className="w-4 h-4 text-gray-500" />
                    </Button>
                    <Textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder="输入消息..."
                        className="resize-none flex-1"
                        style={{ minHeight: '40px', maxHeight: '120px' }}
                    />
                    <Button onClick={handleSend} disabled={isLoading || (!input.trim() && !selectedImage)} className="flex-shrink-0">
                        <Send className="w-4 h-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
