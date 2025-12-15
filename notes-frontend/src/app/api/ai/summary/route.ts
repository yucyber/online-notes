import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const { notes } = await req.json();

        if (!notes || !Array.isArray(notes) || notes.length === 0) {
            return NextResponse.json({ error: '请提供至少一篇笔记' }, { status: 400 });
        }

        // 1. 准备笔记内容
        // 格式化每篇笔记
        const formattedNotes = notes.map((note: any) => {
            const title = note.title || '无标题';
            const time = note.updatedAt ? new Date(note.updatedAt).toLocaleString() : '未知时间';
            const content = note.content || '';
            // 简单去除 HTML 标签，保留文本
            const plainContent = content.replace(/<[^>]+>/g, '');
            return `【${title} (${time})】\n${plainContent}`;
        });

        // 拼接成字符串（用于日志或兼容旧参数）
        const combinedContent = formattedNotes.join('\n\n-------------------\n\n');

        // 2. 调用 Coze Workflow
        const cozeApiUrl = 'https://api.coze.cn/v1/workflow/run';
        const cozeApiKey = process.env.COZE_API_KEY?.trim();
        const workflowId = process.env.COZE_WORKFLOW_ID_SUMMARY?.trim();

        if (!cozeApiKey || !workflowId) {
            console.error('Missing Coze configuration');
            return NextResponse.json({ error: '服务配置缺失: COZE_API_KEY 或 COZE_WORKFLOW_ID_SUMMARY 未设置' }, { status: 500 });
        }

        const payload = {
            workflow_id: workflowId,
            parameters: {
                // 强制将所有笔记内容合并为一个字符串，作为数组的唯一元素传递
                // 这样可以确保 Coze 工作流接收到完整的拼接文本，避免数组转字符串时的潜在问题
                notes_content: [combinedContent],

                // 显式传递 input 变量，作为备用
                input: combinedContent,
            },
        };

        const response = await fetch(cozeApiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${cozeApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[AI Summary] Coze API HTTP Error:', response.status, errorText);
            return NextResponse.json({ error: `AI 服务调用失败 (${response.status}): ${errorText}` }, { status: response.status });
        }

        const data = await response.json();

        // 解析 Coze 返回结果
        // 假设 Coze 返回结构: { code: 0, data: "{\"summary\": \"...\"}" } 或直接包含 summary
        let summary = '';

        if (data.code === 0) {
            // 尝试解析 data 字段，如果它是 JSON 字符串
            try {
                const parsedData = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
                summary = parsedData.summary || parsedData.output || (typeof parsedData === 'string' ? parsedData : JSON.stringify(parsedData));
            } catch (e) {
                // 如果解析失败，直接使用 data
                summary = String(data.data);
            }
        } else {
            console.error('[AI Summary] Coze API Logic Error:', data);
            return NextResponse.json({ error: data.msg || `生成摘要失败 (Code: ${data.code})` }, { status: 500 });
        }

        return NextResponse.json({ summary });

    } catch (error: any) {
        console.error('Summary API Error:', error);
        return NextResponse.json({ error: error.message || '内部服务器错误' }, { status: 500 });
    }
}
