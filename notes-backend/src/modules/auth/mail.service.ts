import { Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createTransport } from 'nodemailer'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rootCertificates } from 'node:tls'

// QQ SMTP 的 *.qq.com 证书由腾讯 TecSign-Root 签发，该根证书不在 Node 内置 CA 列表中；
// 未安装 QQ 客户端的 Linux/容器环境无法仅靠系统 CA 验证，因此附带根证书仅用于本次 SMTP 连接。
const QQ_SMTP_CA = (() => {
  try {
    return readFileSync(join(__dirname, '../../../config/tecsign-root.pem'), 'utf8')
  } catch {
    return undefined
  }
})()

const QQ_SMTP_TLS_CA = QQ_SMTP_CA ? [QQ_SMTP_CA, ...rootCertificates] : undefined

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
        tls: QQ_SMTP_TLS_CA ? { ca: QQ_SMTP_TLS_CA } : undefined,
      })
      await this.transporter.sendMail({
        from,
        to: email,
        subject: '在线笔记注册验证码',
        text: `你的在线笔记注册验证码是：${code}，10 分钟内有效。`,
      })
    } catch (error) {
      // 只记录 nodemailer 的网络/TLS/认证错误，不打印 SMTP 凭据与验证码，避免把根因信息吞成笼统的 Error。
      const safeDetail = error instanceof Error
        ? { name: error.name, message: error.message, code: (error as { code?: unknown }).code }
        : { type: typeof error }
      this.logger.error(`验证码邮件发送失败：${JSON.stringify(safeDetail)}`)
      throw new ServiceUnavailableException('验证码邮件暂时无法发送，请稍后重试')
    }
  }
}
