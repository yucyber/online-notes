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

async function postAiJson(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const errorData = await response.json();
      detail = errorData.error || errorData.message || detail;
    } catch {
      // keep statusText
    }
    throw new Error(`AI service request failed: ${detail}`);
  }

  return response.json();
}

/** Trust backend AiService normalize/repair; only unwrap legacy messages envelope. */
export const getAIMindMapData = async (content: string | any, scenario: MindMapScenario = 'generate') => {
  const data = await postAiJson('/api/ai/mindmap', { content, scenario });
  const messageContent = extractAnswerMessage(data);
  return JSON.parse(messageContent);
};

/** Trust backend Mermaid normalize/repair; only unwrap legacy messages envelope. */
export const getAIMermaidData = async (content: string, availableIcons: string[] = []) => {
  const data = await postAiJson('/api/ai/mermaid', { content, availableIcons });
  return extractAnswerMessage(data);
};
