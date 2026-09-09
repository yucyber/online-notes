import { Transform } from 'class-transformer'
import { IsEmail } from 'class-validator'

export class SendEmailCodeDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  email: string
}
