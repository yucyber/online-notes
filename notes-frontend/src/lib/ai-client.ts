'use client';

export type MindMapScenario = 'generate' | 'expand' | 'optimize';

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

function requireContent(data: any): unknown {
  if (data && Object.prototype.hasOwnProperty.call(data, 'content')) {
    return data.content
  }
  throw new Error('No AI response was returned')
}

/** Trust backend AiService normalize/repair; expect `{ content }`. */
export const getAIMindMapData = async (content: string | any, scenario: MindMapScenario = 'generate') => {
  const data = await postAiJson('/api/ai/mindmap', { content, scenario });
  const payload = requireContent(data);
  return typeof payload === 'string' ? JSON.parse(payload) : payload;
};

/** Trust backend Mermaid normalize/repair; expect `{ content: string }`. */
export const getAIMermaidData = async (content: string, availableIcons: string[] = []) => {
  const data = await postAiJson('/api/ai/mermaid', { content, availableIcons });
  const payload = requireContent(data);
  return String(payload);
};
