import { Transform } from 'class-transformer'
import { IsEmail } from 'class-validator'

export class SendEmailCodeDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  email: string
}
