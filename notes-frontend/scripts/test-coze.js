const fs = require('fs');
const path = require('path');
const https = require('https');

const envPath = path.join(__dirname, '../.env.local');

console.log('🔍 正在检查 Coze 配置...');

try {
    if (!fs.existsSync(envPath)) {
        console.error('❌ 错误: 找不到 .env.local 文件');
        process.exit(1);
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    const env = {};
    envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^["']|["']$/g, ''); // remove quotes
            env[key] = value;
        }
    });

    const apiKey = env.COZE_API_KEY;
    const workflowId = env.COZE_WORKFLOW_ID_SUMMARY;

    if (!apiKey || !workflowId) {
        console.error('❌ 错误: .env.local 中缺少 COZE_API_KEY 或 COZE_WORKFLOW_ID_SUMMARY');
        console.log('当前读取到的键:', Object.keys(env));
        process.exit(1);
    }

    console.log('✅ 环境变量读取成功');
    console.log(`Workflow ID: ${workflowId}`);
    console.log(`API Key: ${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`);

    const data = JSON.stringify({
        workflow_id: workflowId,
        parameters: {
            input: "这是一个测试文本，用于验证 Coze Workflow 是否配置正确。",
            query: "这是一个测试文本，用于验证 Coze Workflow 是否配置正确。",
            content: "这是一个测试文本，用于验证 Coze Workflow 是否配置正确。"
        }
    });

    const options = {
        hostname: 'api.coze.cn',
        path: '/v1/workflow/run',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    console.log('\n🔄 正在调用 Coze API...');

    const req = https.request(options, (res) => {
        let responseBody = '';

        res.on('data', (chunk) => {
            responseBody += chunk;
        });

        res.on('end', () => {
            console.log(`\n📡 HTTP 状态码: ${res.statusCode}`);
            try {
                const json = JSON.parse(responseBody);
                console.log('📄 返回结果:', JSON.stringify(json, null, 2));

                if (res.statusCode === 200 && json.code === 0) {
                    console.log('\n✅ 测试成功！Workflow 配置正确且可以正常调用。');
                    console.log('请确保您的 Workflow 返回了包含 summary 字段的 JSON 或字符串。');
                } else {
                    console.log('\n❌ 测试失败。');
                    if (json.code === 4000001) console.log('👉 原因: 鉴权失败，请检查 COZE_API_KEY 是否正确。');
                    else if (json.msg && json.msg.includes('published')) console.log('👉 原因: Workflow 未发布。请在 Coze 平台点击右上角“发布”按钮。');
                    else if (json.code === 4000002) console.log('👉 原因: 权限不足或 Workflow ID 错误。');
                    else console.log(`👉 错误信息: ${json.msg}`);
                }
            } catch (e) {
                console.log('返回非 JSON 内容:', responseBody);
            }
        });
    });

    req.on('error', (error) => {
        console.error('❌ 请求发送失败:', error);
    });

    req.write(data);
    req.end();

} catch (err) {
    console.error('❌ 发生异常:', err.message);
}
