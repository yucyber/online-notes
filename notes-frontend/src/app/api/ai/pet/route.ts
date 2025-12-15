import { NextResponse } from 'next/server';

const COZE_API_BASE = 'https://api.coze.cn';

async function uploadImageToCoze(file: File, apiKey: string): Promise<string> {
    try {
        console.log(`[Coze Upload] Starting upload for ${file.name} (${file.size} bytes, type: ${file.type})`);
        const formData = new FormData();
        const arrayBuffer = await file.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: file.type || 'application/octet-stream' });
        formData.append('file', blob, file.name || 'image.png');

        const response = await fetch(`${COZE_API_BASE}/v1/files/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
            body: formData,
        });

        if (!response.ok) {
            const error = await response.text();
            console.error(`[Coze Upload] HTTP Error ${response.status}: ${error}`);
            throw new Error(`HTTP ${response.status}: ${error}`);
        }

        const data = await response.json();
        console.log('[Coze Upload] Response:', JSON.stringify(data));

        if (data.code !== 0) {
            throw new Error(`API Error (${data.code}): ${data.msg}`);
        }

        return data.data.id;
    } catch (e) {
        console.error('[Coze Upload] Exception:', e);
        throw e;
    }
}

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const message = formData.get('message') as string;
        const conversationId = formData.get('conversationId') as string;
        const imageFile = formData.get('image') as File | null;

        const apiKey = process.env.COZE_API_KEY || process.env.NEXT_PUBLIC_COZE_API_KEY;
        const botId = process.env.COZE_BOT_ID || process.env.NEXT_PUBLIC_COZE_BOT_ID;

        if (!apiKey || !botId) {
            return NextResponse.json(
                { error: 'Configuration missing: COZE_API_KEY or COZE_BOT_ID' },
                { status: 500 }
            );
        }

        const additionalMessages: any[] = [];

        // Handle Image Upload if present
        if (imageFile) {
            try {
                const fileId = await uploadImageToCoze(imageFile, apiKey);
                additionalMessages.push({
                    role: 'user',
                    content: JSON.stringify([
                        {
                            type: 'image',
                            file_id: fileId,
                        },
                        {
                            type: 'text',
                            text: message || 'Analyze this image',
                        }
                    ]),
                    content_type: 'object_string',
                });
            } catch (error: any) {
                console.error('Image upload failed:', error);
                return NextResponse.json(
                    { error: `Image upload failed: ${error.message}` },
                    { status: 500 }
                );
            }
        } else {
            additionalMessages.push({
                role: 'user',
                content: message,
                content_type: 'text',
            });
        }

        const payload: any = {
            bot_id: botId,
            user_id: 'user_guest', // In a real app, use the actual user ID
            stream: true,
            auto_save_history: true,
            additional_messages: additionalMessages,
        };

        if (conversationId) {
            payload.conversation_id = conversationId;
        }

        const response = await fetch(`${COZE_API_BASE}/v3/chat`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Coze API Error:', errorText);
            throw new Error(`Coze API Error: ${response.statusText}`);
        }

        // Stream the response
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

                        let currentEvent = '';

                        for (const line of lines) {
                            if (line.startsWith('event:')) {
                                currentEvent = line.slice(6).trim();
                            } else if (line.startsWith('data:')) {
                                const dataStr = line.slice(5).trim();
                                if (!dataStr) continue;

                                try {
                                    const data = JSON.parse(dataStr);

                                    // Determine event type: prefer data.event, fallback to SSE event line
                                    const eventType = data.event || currentEvent;

                                    // Handle conversation.message.delta
                                    if (eventType === 'conversation.message.delta') {
                                        const payload = data.data || data;
                                        // Strict filtering: only allow 'answer' type messages to avoid leaking tool outputs or debug info
                                        if (payload.type === 'answer' && payload.content) {
                                            controller.enqueue(payload.content);
                                        }
                                    }
                                    // Fallback: sometimes simple chat response just has content
                                    else if (!eventType && data.content && data.role === 'assistant' && data.type === 'answer') {
                                        controller.enqueue(data.content);
                                    }
                                } catch {
                                    // Ignore parse errors for non-JSON lines
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.error('Stream processing error:', err);
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
        console.error('API Route Error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
