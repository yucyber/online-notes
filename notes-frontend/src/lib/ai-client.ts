'use client';

export type MindMapScenario = 'generate' | 'expand' | 'optimize';

export type RagCitation = { evidenceId: string; noteId: string; noteTitle: string; chunkId: string; headingPath: string[]; excerpt: string; score?: number };
export type RagAnswer = { answer: string; citations: RagCitation[]; planSummary: { intent: string; tools: string[]; graphHops: 0 | 1; rerankApplied: boolean }; warnings: string[]; runId?: string };

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
  const payload = data?.data && typeof data.data === 'object' ? data.data : data
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'content')) {
    return payload.content
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

export const getRagAnswer = async (question: string, knowledgeBaseId?: string): Promise<RagAnswer> => {
  const data = await postAiJson('/api/ai/rag/answer', { question, ...(knowledgeBaseId ? { knowledgeBaseId } : {}) });
  const payload = data?.data && typeof data.data === 'object' ? data.data : data;
  if (!payload || typeof payload.answer !== 'string' || !Array.isArray(payload.citations) || !Array.isArray(payload.warnings)) throw new Error('No knowledge assistant response was returned');
  return payload as RagAnswer;
};
