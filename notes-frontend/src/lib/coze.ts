'use client';

// 由于 @coze/web-sdk 安装失败，这里使用 fetch 直接调用 API
// 实际项目中建议使用官方 SDK 或 axios

export type MindMapScenario = 'generate' | 'expand' | 'optimize';

export const getAIMindMapData = async (content: string | any, scenario: MindMapScenario = 'generate') => {
    try {
        // 使用 Next.js API Route 代理请求，解决 CORS 问题
        const response = await fetch('/api/ai/mindmap', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content,
                scenario
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('COZE API Error:', errorData);
            throw new Error(`AI 服务调用失败: ${response.statusText}`);
        }

        const data = await response.json();

        // 解析返回的消息内容
        // 注意：这里需要根据实际 COZE API v2 的返回结构进行调整
        // 假设返回结构中有 messages 数组，且最后一个消息是 bot 的回复
        const messages = data.messages;
        const lastMessage = messages.find((msg: any) => msg.type === 'answer');

        if (!lastMessage) {
            throw new Error('未获取到 AI 回复');
        }

        const messageContent = lastMessage.content;

        let parsedData;
        try {
            // 尝试解析 JSON，处理可能的 Markdown 包裹或额外文本
            let jsonStr = messageContent.replace(/```json\n?|\n?```/g, '').trim();

            // 如果包含非 JSON 字符，尝试提取 JSON 部分
            const firstBrace = jsonStr.indexOf('{');
            const lastBrace = jsonStr.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
            }

            parsedData = JSON.parse(jsonStr);
        } catch {
            console.warn('AI response is not valid JSON, attempting fallback parsing:', messageContent);

            // Fallback logic for non-JSON responses (e.g. Markdown images or plain text)
            if (messageContent.trim().startsWith('![')) {
                // Markdown Image: ![alt](url)
                const match = messageContent.match(/!\[(.*?)\]\((.*?)\)/);
                if (match) {
                    const alt = match[1];
                    const url = match[2];
                    parsedData = {
                        nodeData: {
                            id: 'root',
                            topic: alt || 'AI Generated Image',
                            children: [],
                            data: { image: url } // Store image URL for potential future use
                        }
                    };
                }
            }

            // If still not parsed, treat as plain text
            if (!parsedData) {
                parsedData = {
                    nodeData: {
                        id: 'root',
                        topic: 'AI Response',
                        children: [
                            {
                                id: 'child-text',
                                topic: messageContent
                            }
                        ]
                    }
                };
            }
        }

        return parsedData;

    } catch (error) {
        console.error('COZE AI 调用失败:', error);
        throw error;
    }
};

export const getAIMermaidData = async (content: string, availableIcons: string[] = []) => {
    try {
        const response = await fetch('/api/ai/mermaid', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, availableIcons })
        });

        if (!response.ok) {
            throw new Error(`AI 服务调用失败: ${response.statusText}`);
        }

        const data = await response.json();
        const messages = data.messages;
        const lastMessage = messages.find((msg: any) => msg.type === 'answer');

        if (!lastMessage) {
            throw new Error('未获取到 AI 回复');
        }

        let mermaidCode = lastMessage.content;
        // 清理 Markdown 代码块标记
        mermaidCode = mermaidCode.replace(/```mermaid\n?|\n?```/g, '').replace(/```\n?|\n?```/g, '').trim();

        return mermaidCode;
    } catch (error) {
        console.error('COZE AI Mermaid 调用失败:', error);
        throw error;
    }
};
