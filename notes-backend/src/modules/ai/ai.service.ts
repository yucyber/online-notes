import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiService {
    private readonly logger = new Logger(AiService.name);
    private readonly apiUrl = 'https://api.coze.cn/open_api/v2/chat';

    constructor(private readonly configService: ConfigService) { }

    async generateSummary(content: string): Promise<string> {
        const apiToken = this.configService.get<string>('COZE_API_KEY');
        const botId = this.configService.get<string>('COZE_BOT_ID');

        if (!apiToken || !botId) {
            this.logger.warn('COZE_API_KEY or COZE_BOT_ID not configured. Returning truncated content.');
            return this.truncateContent(content);
        }

        // Truncate content to 3000 chars to control costs/limits
        const truncatedContent = content.substring(0, 3000);

        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiToken}`,
                    'Content-Type': 'application/json',
                    'Accept': '*/*',
                    'Host': 'api.coze.cn',
                    'Connection': 'keep-alive'
                },
                body: JSON.stringify({
                    bot_id: botId,
                    user: 'system_summary_generator',
                    query: `请为以下笔记内容生成一个简短的摘要（200字以内），直接返回摘要内容，不要包含任何前缀或解释：\n\n${truncatedContent}`,
                    stream: false,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                this.logger.error(`Coze API failed: ${response.status} ${response.statusText} - ${errorText}`);
                return this.truncateContent(content);
            }

            const data = await response.json();

            // Parse Coze response structure
            // Note: The structure depends on Coze API version. Assuming standard chat response.
            // Usually data.messages is an array, and we look for the answer.
            // Adjust based on actual Coze API response format.
            // For v2 chat:
            // { messages: [ { role: 'assistant', type: 'answer', content: '...' } ], ... }

            const answer = data.messages?.find((m: any) => m.role === 'assistant' && m.type === 'answer');

            if (answer && answer.content) {
                return answer.content.trim();
            } else {
                this.logger.warn('Coze API response did not contain expected answer format.');
                return this.truncateContent(content);
            }

        } catch (error) {
            this.logger.error('Error calling Coze API:', error);
            return this.truncateContent(content);
        }
    }

    private truncateContent(content: string): string {
        // Remove HTML tags and markdown characters for cleaner fallback
        const cleanText = content
            .replace(/<[^>]+>/g, '')
            .replace(/[#*`_~>\[\]()]/g, '')
            .trim();
        return cleanText.substring(0, 200) + (cleanText.length > 200 ? '...' : '');
    }
}
