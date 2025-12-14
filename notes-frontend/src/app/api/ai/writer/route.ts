import { NextResponse } from 'next/server';

// 构建提示词
function buildPrompt(type: 'continue' | 'polish' | 'summary', context: string, userPrompt?: string): string {
    switch (type) {
        case 'continue':
            return `你是一个专业的写作助手。请根据以下上下文续写一段文字。
上下文：
${context}
${userPrompt ? `用户额外要求：${userPrompt}` : ''}

要求：
1. 风格与前文保持一致。
2. 内容连贯，逻辑通顺。
3. 直接输出续写的内容，不要包含任何开场白或解释。`;

        case 'polish':
            return `你是一个专业的文字编辑。请润色以下文字，使其更加流畅、专业，修正语病，但不要改变原意。
待润色内容：
${context}
${userPrompt ? `用户额外要求：${userPrompt}` : ''}

要求：
1. 直接输出润色后的内容。
2. 不要包含任何解释或Markdown标记（除非原文有）。`;

        case 'summary':
            return `请为以下内容生成一个简短的摘要（200字以内）。
内容：
${context}

要求：
1. 语言精练，概括核心要点。
2. 直接输出摘要内容。`;

        default:
            return context;
    }
}

export async function POST(request: Request) {
    try {
        const { prompt, context, type } = await request.json();

        const apiKey = process.env.COZE_API_KEY || process.env.NEXT_PUBLIC_COZE_API_KEY;
        const botId = process.env.COZE_BOT_ID || process.env.NEXT_PUBLIC_COZE_BOT_ID;

        if (!apiKey || !botId) {
            return NextResponse.json(
                { error: 'COZE API Key or Bot ID is missing' },
                { status: 500 }
            );
        }

        const query = buildPrompt(type, context, prompt);

        const response = await fetch('https://api.coze.cn/open_api/v2/chat', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
            },
            body: JSON.stringify({
                bot_id: botId,
                user: 'user_' + Math.random().toString(36).slice(2),
                query: query,
                stream: true,
            }),
        });

        if (!response.ok) {
            throw new Error(`Coze API Error: ${response.statusText}`);
        }

        // 创建流式响应
        const stream = new ReadableStream({
            async start(controller) {
                const reader = response.body?.getReader();
                if (!reader) {
                    controller.close();
                    return;
                }

                const decoder = new TextDecoder();
                let buffer = '';

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (line.startsWith('data:')) {
                                const dataStr = line.slice(5).trim();
                                if (!dataStr) continue;

                                try {
                                    const data = JSON.parse(dataStr);
                                    // Coze V2 API SSE 格式处理
                                    // event: message -> data.message.content
                                    // event: conversation.message.delta -> data.content (V3) - 这里假设是 V2

                                    // 检查是否是消息事件
                                    if (data.event === 'message' && data.message && data.message.type === 'answer') {
                                        const content = data.message.content;
                                        if (content) {
                                            controller.enqueue(new TextEncoder().encode(content));
                                        }
                                    } else if (data.event === 'done') {
                                        // 完成
                                    }
                                } catch (e) {
                                    console.error('JSON Parse Error', e);
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.error('Stream Error', err);
                    controller.error(err);
                } finally {
                    controller.close();
                }
            },
        });

        return new NextResponse(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error: any) {
        console.error('AI Writer Error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
