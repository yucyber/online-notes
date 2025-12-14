import { NextResponse } from 'next/server';

function buildPrompt(content: string, availableIcons: string[] = []): string {
    let iconPrompt = '';
    if (availableIcons && availableIcons.length > 0) {
        iconPrompt = `
7. 【重要】用户拥有以下自定义素材图标（名称）：${availableIcons.join(', ')}。
   请在生成图表时，必须优先使用这些名称作为节点的文本内容，以便系统能自动替换为图标。
   - 必须强制检查每个节点：如果节点含义与任意一个可用图标相关，必须使用该图标名称作为节点文本的主体。
   - 格式要求：使用 "图标名称" 或 "图标名称\\n说明文字"。
   - 例如：可用图标 ["User", "DB"]。用户说 "用户查询数据库"。
     错误生成：A[用户] --> B[数据库]
     正确生成：A[User\\n用户] --> B[DB\\n数据库]
   - 请勿翻译图标名称，必须保持原样（包括大小写）。
`;
    }

    return `
你是一个专业的图表生成助手。请根据用户的描述，生成对应的 Mermaid.js 图表代码。

用户描述：${content}

要求：
1. 仅返回 Mermaid 代码，不要包含 Markdown 代码块标记（如 \`\`\`mermaid），不要包含任何解释性文字。
2. 代码必须符合 Mermaid 语法规范。
3. 支持流程图（flowchart）、时序图（sequenceDiagram）、类图（classDiagram）、状态图（stateDiagram）、实体关系图（erDiagram）等。
4. 如果用户没有指定图表类型，请根据描述内容自动选择最合适的类型。
5. 确保生成的图表内容使用中文（如果用户描述是中文）。
6. 尽量使用简单的语法，避免复杂的嵌套，以确保兼容性。${iconPrompt}

示例输出：
graph TD
    A[开始] --> B{判断}
    B -- 是 --> C[执行]
    B -- 否 --> D[结束]
    C --> D
`;
}

export async function POST(request: Request) {
    try {
        const { content, availableIcons } = await request.json();

        const apiKey = process.env.COZE_API_KEY || process.env.NEXT_PUBLIC_COZE_API_KEY;
        const botId = process.env.COZE_BOT_ID || process.env.NEXT_PUBLIC_COZE_BOT_ID;

        if (!apiKey || !botId) {
            return NextResponse.json(
                { error: 'COZE API Key or Bot ID is missing in environment variables' },
                { status: 500 }
            );
        }

        const query = buildPrompt(content, availableIcons);

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
