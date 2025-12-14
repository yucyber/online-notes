import { NextResponse } from 'next/server';

function buildPrompt(scenario: string, content: any): string {
    switch (scenario) {
        case "expand":
            return `
请为以下节点扩展子节点：
节点：${typeof content === 'string' ? content : content.nodeName}

要求：
1. 返回合法 JSON 格式，不要包含 Markdown 或图片。
2. 数据结构必须符合：
{
  "id": "${typeof content === 'string' ? 'root' : content.nodeId}",
  "topic": "${typeof content === 'string' ? content : content.nodeName}",
  "children": [
    { "id": "new1", "topic": "扩展子节点1", "children": [] },
    { "id": "new2", "topic": "扩展子节点2", "children": [] }
  ]
}
3. 不要返回除 JSON 以外的任何内容。
4. 请确保所有生成的内容都使用中文。
      `;
        case "optimize":
            return `
请优化以下思维导图数据，使其更清晰合理：
${typeof content === 'string' ? content : JSON.stringify(content)}

要求：
1. 返回合法 JSON 格式，不要包含 Markdown 或图片。
2. 保持原有结构，但可以调整节点顺序、合并重复节点、增加合理的子节点。
3. 数据结构必须符合 MindElixir 的格式：
{
  "nodeData": {
    "id": "root",
    "topic": "主题",
    "children": [...]
  }
}
4. 不要返回除 JSON 以外的任何内容。
5. 请确保所有生成的内容都使用中文。
      `;
        case "generate":
        default:
            return `
请根据以下主题生成一个思维导图：
主题：${typeof content === 'string' ? content : content.topic}

要求：
1. 返回合法 JSON 格式，不要包含 Markdown、图片或文字说明。
2. JSON 数据结构必须符合以下格式：
{
  "nodeData": {
    "id": "root",
    "topic": "${typeof content === 'string' ? content : content.topic}",
    "children": [
      { "id": "child1", "topic": "子节点1", "children": [] },
      { "id": "child2", "topic": "子节点2", "children": [] }
    ]
  }
}
3. 所有节点必须有唯一的 id 和 topic。
4. 不要返回除 JSON 以外的任何内容。
5. 请确保所有生成的内容（主题和节点）都使用中文。
      `;
    }
}

export async function POST(request: Request) {
    try {
        const { content, scenario = 'generate' } = await request.json();

        // 优先使用服务端环境变量，如果没有则尝试使用公共环境变量
        const apiKey = process.env.COZE_API_KEY || process.env.NEXT_PUBLIC_COZE_API_KEY;
        const botId = process.env.COZE_BOT_ID || process.env.NEXT_PUBLIC_COZE_BOT_ID;

        if (!apiKey || !botId) {
            return NextResponse.json(
                { error: 'COZE API Key or Bot ID is missing in environment variables' },
                { status: 500 }
            );
        }

        const query = buildPrompt(scenario, content);

        const response = await fetch('https://api.coze.cn/open_api/v2/chat', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Accept': '*/*',
                'Host': 'api.coze.cn',
                'Connection': 'keep-alive'
            },
            body: JSON.stringify({
                bot_id: botId,
                user: 'user_' + Math.random().toString(36).slice(2),
                query: query,
                stream: false
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Coze API Error:', errorText);
            return NextResponse.json(
                { error: `Coze API responded with ${response.status}: ${errorText}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error('API Route Error:', error);
        return NextResponse.json(
            { error: 'Internal Server Error' },
            { status: 500 }
        );
    }
}
