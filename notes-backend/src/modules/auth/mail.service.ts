import { Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createTransport } from 'nodemailer'

interface MailTransporter {
  sendMail(message: {
    from: string
    to: string
    subject: string
    text: string
  }): Promise<unknown>
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)
  private transporter?: MailTransporter

  constructor(
    private readonly configService: ConfigService,
    @Optional() transporter?: MailTransporter,
  ) {
    this.transporter = transporter
  }

  async sendVerificationCode(email: string, code: string): Promise<void> {
    // SMTP 缺失只影响验证码发送，不能阻断已有账号登录所需的 AuthModule 启动。
    const host = this.configService.get<string>('SMTP_HOST')
    const port = this.configService.get<string>('SMTP_PORT')
    const secure = this.configService.get<string>('SMTP_SECURE')
    const user = this.configService.get<string>('SMTP_USER')
    const password = this.configService.get<string>('SMTP_PASSWORD')
    const from = this.configService.get<string>('MAIL_FROM')

    if ([host, port, secure, user, password, from].some(value => !value)) {
      throw new ServiceUnavailableException('验证码邮件暂时无法发送，请稍后重试')
    }

    try {
      this.transporter ??= createTransport({
        host,
        port: Number(port),
        secure: String(secure) === 'true',
        auth: { user, pass: password },
      })
      await this.transporter.sendMail({
        from,
        to: email,
        subject: '在线笔记注册验证码',
        text: `你的在线笔记注册验证码是：${code}，10 分钟内有效。`,
      })
    } catch (error) {
      const errorType = error instanceof Error ? error.name : typeof error
      this.logger.error(`验证码邮件发送失败：${errorType}`)
      throw new ServiceUnavailableException('验证码邮件暂时无法发送，请稍后重试')
    }
  }
}
