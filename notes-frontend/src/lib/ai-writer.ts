export type AIWriterType = 'continue' | 'polish' | 'summary';

interface AIWriterOptions {
    prompt?: string;
    context: string;
    type: AIWriterType;
    onChunk: (text: string) => void;
    onDone?: () => void;
    onError?: (err: Error) => void;
}

export const streamAIWriter = async ({
    prompt,
    context,
    type,
    onChunk,
    onDone,
    onError,
}: AIWriterOptions) => {
    try {
        const response = await fetch('/api/ai/writer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt,
                context,
                type,
            }),
        });

        if (!response.ok) {
            throw new Error(`AI request failed: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value, { stream: true });
            onChunk(text);
        }

        onDone?.();
    } catch (error: any) {
        console.error('AI Writer Error:', error);
        onError?.(error);
    }
};
