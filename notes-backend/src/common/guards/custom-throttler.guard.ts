import { ThrottlerGuard } from '@nestjs/throttler';
import { Injectable } from '@nestjs/common';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.ips?.length ? req.ips[0] : req.ip || 'unknown';
  }
  // 只覆盖 IP 提取；限流判断由基类 canActivate 完成，不要覆盖 shouldBlock
}
