import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

@Injectable()
export class EmbeddingService {
    private readonly logger = new Logger(EmbeddingService.name);
    private readonly zhipuApiKey: string;

    constructor(private readonly configService: ConfigService) {
        // Try to get from ConfigService first, then fallback to process.env directly
        this.zhipuApiKey = this.configService.get<string>('ZHIPU_API_KEY') || process.env.ZHIPU_API_KEY;

        if (!this.zhipuApiKey) {
            this.logger.warn('ZHIPU_API_KEY not found in ConfigService or process.env');
        } else {
            this.logger.log(`ZHIPU_API_KEY loaded (length: ${this.zhipuApiKey.length})`);
        }
    }

    /**
     * Generate JWT token for Zhipu AI API
     */
    private generateToken(apiKey: string): string {
        if (!apiKey || !apiKey.includes('.')) {
            throw new Error('Invalid Zhipu API Key format');
        }

        const [id, secret] = apiKey.split('.');
        const now = Date.now();
        const exp = now + 3600 * 1000; // 1 hour validity

        const header = { alg: 'HS256', sign_type: 'SIGN' };
        const payload = { api_key: id, exp, timestamp: now };

        const base64UrlEncode = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url');

        const encodedHeader = base64UrlEncode(header);
        const encodedPayload = base64UrlEncode(payload);

        const signature = createHmac('sha256', Buffer.from(secret, 'utf8'))
            .update(`${encodedHeader}.${encodedPayload}`)
            .digest('base64url');

        return `${encodedHeader}.${encodedPayload}.${signature}`;
    }

    async generateEmbedding(text: string): Promise<number[]> {
        if (!text) return [];

        // Fallback or check for API Key
        if (!this.zhipuApiKey) {
            this.logger.warn('ZHIPU_API_KEY is not set. Skipping embedding generation.');
            return [];
        }

        let attempts = 0;
        const maxAttempts = 3;
        const start = Date.now();

        while (attempts < maxAttempts) {
            try {
                this.logger.log(`Generating embedding for text (length: ${text.length}), attempt ${attempts + 1}...`);

                const token = this.generateToken(this.zhipuApiKey);

                const response = await fetch('https://open.bigmodel.cn/api/paas/v4/embeddings', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: 'embedding-2',
                        input: text,
                    }),
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`Zhipu API error: ${response.status} ${response.statusText} - ${errText}`);
                }

                const result = await response.json();
                const duration = Date.now() - start;
                this.logger.log(`Zhipu API response received in ${duration}ms`);

                // Zhipu API response format:
                // {
                //   "data": [
                //     { "embedding": [...], "index": 0, "object": "embedding" }
                //   ],
                //   "model": "embedding-2",
                //   "object": "list",
                //   "usage": { ... }
                // }

                if (result.data && Array.isArray(result.data) && result.data.length > 0) {
                    return result.data[0].embedding;
                } else {
                    this.logger.warn(`Unexpected data format from Zhipu: ${JSON.stringify(result)}`);
                    return [];
                }

            } catch (error) {
                attempts++;
                this.logger.error(`Attempt ${attempts} failed: ${error.message}`);
                if (attempts >= maxAttempts) {
                    this.logger.error('Max retry attempts reached for embedding generation.');
                    return [];
                }
                // Exponential backoff
                await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
            }
        }
        return [];
    }
}
