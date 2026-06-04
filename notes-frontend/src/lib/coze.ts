'use client';

export type MindMapScenario = 'generate' | 'expand' | 'optimize';

function extractAnswerMessage(data: any): string {
    const messages = data?.messages;
    const lastMessage = Array.isArray(messages)
        ? messages.find((msg: any) => msg.type === 'answer')
        : null;

    if (!lastMessage?.content) {
        throw new Error('No AI response was returned');
    }

    return String(lastMessage.content);
}

export const getAIMindMapData = async (content: string | any, scenario: MindMapScenario = 'generate') => {
    try {
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
            console.error('AI Gateway Error:', errorData);
            throw new Error(`AI service request failed: ${response.statusText}`);
        }

        const data = await response.json();
        const messageContent = extractAnswerMessage(data);

        let parsedData;
        try {
            let jsonStr = messageContent.replace(/```json\n?|\n?```/g, '').trim();

            const firstBrace = jsonStr.indexOf('{');
            const lastBrace = jsonStr.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
            }

            parsedData = JSON.parse(jsonStr);
        } catch {
            console.warn('AI response is not valid JSON, attempting fallback parsing:', messageContent);

            if (messageContent.trim().startsWith('![')) {
                const match = messageContent.match(/!\[(.*?)\]\((.*?)\)/);
                if (match) {
                    const alt = match[1];
                    const url = match[2];
                    parsedData = {
                        nodeData: {
                            id: 'root',
                            topic: alt || 'AI Generated Image',
                            children: [],
                            data: { image: url }
                        }
                    };
                }
            }

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
        console.error('AI Gateway mindmap request failed:', error);
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
            throw new Error(`AI service request failed: ${response.statusText}`);
        }

        const data = await response.json();
        let mermaidCode = extractAnswerMessage(data);
        mermaidCode = mermaidCode.replace(/```mermaid\n?|\n?```/g, '').replace(/```\n?|\n?```/g, '').trim();

        return mermaidCode;
    } catch (error) {
        console.error('AI Gateway Mermaid request failed:', error);
        throw error;
    }
};
