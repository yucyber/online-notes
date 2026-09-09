import { BadRequestException, Logger, ServiceUnavailableException, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { SendEmailCodeDto } from '../src/modules/auth/dto/email-verification.dto'
import { MailService } from '../src/modules/auth/mail.service'
import { CreateUserDto } from '../src/modules/users/dto'

Logger.overrideLogger(false)

const validationPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
})

async function validate<T extends object>(metatype: new () => T, value: unknown) {
  return validationPipe.transform(value, {
    type: 'body',
    metatype,
  }) as Promise<T>
}

const smtpConfig = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'mailer@example.com',
  SMTP_PASSWORD: 'app-password',
  MAIL_FROM: 'Online Notes <mailer@example.com>',
}

test('发送验证码邮箱会去除首尾空白并转为小写', async () => {
  const dto = await validate(SendEmailCodeDto, { email: '  User@Example.COM  ' })

  assert.equal(dto.email, 'user@example.com')
})

test('注册验证码只接受 6 位数字', async () => {
  const valid = await validate(CreateUserDto, {
    email: 'user@example.com',
    password: 'secret1',
    verificationCode: '012345',
  })

  assert.equal(valid.verificationCode, '012345')

  for (const verificationCode of [undefined, '12345', '1234567', '12345a', '１２３４５６']) {
    await assert.rejects(
      validate(CreateUserDto, {
        email: 'user@example.com',
        password: 'secret1',
        verificationCode,
      }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException)
        const response = error.getResponse() as { message: string[] }
        assert.ok(response.message.includes('请输入6位数字验证码'))
        return true
      },
    )
  }
})

test('验证码邮件包含固定收件人、主题和正文', async () => {
  const sentMessages: Record<string, unknown>[] = []
  const transporter = {
    sendMail: async (message: Record<string, unknown>) => {
      sentMessages.push(message)
    },
  }
  const service = new MailService(new ConfigService(smtpConfig), transporter)

  await service.sendVerificationCode('user@example.com', '012345')

  assert.deepEqual(sentMessages, [{
    from: smtpConfig.MAIL_FROM,
    to: 'user@example.com',
    subject: '在线笔记注册验证码',
    text: '你的在线笔记注册验证码是：012345，10 分钟内有效。',
  }])
})

test('缺少 SMTP 配置时仅拒绝发送验证码', async () => {
  const service = new MailService(new ConfigService({}))

  await assert.rejects(
    service.sendVerificationCode('user@example.com', '012345'),
    ServiceUnavailableException,
  )
})

test('底层发送失败时只暴露统一服务不可用错误', async () => {
  const transporter = {
    sendMail: async () => {
      throw new Error('SMTP_PASSWORD=do-not-leak')
    },
  }
  const service = new MailService(new ConfigService(smtpConfig), transporter)

  await assert.rejects(
    service.sendVerificationCode('user@example.com', '012345'),
    (error: unknown) => {
      assert.ok(error instanceof ServiceUnavailableException)
      assert.equal(error.message, '验证码邮件暂时无法发送，请稍后重试')
      assert.doesNotMatch(error.message, /do-not-leak/)
      return true
    },
  )
})
