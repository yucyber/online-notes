import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MinLength, MaxLength } from 'class-validator';

export class CreateUserDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  email: string;

  @IsString({ message: '密码必须是字符串' })
  @MinLength(6, { message: '密码至少6个字符' })
  @MaxLength(50, { message: '密码不能超过50个字符' })
  password: string;

  @Matches(/^\d{6}$/, { message: '请输入6位数字验证码' })
  verificationCode: string;
}

export class LoginUserDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  email: string;

  @IsString({ message: '密码必须是字符串' })
  password: string;
}

export { UpdateProfileDto } from './update-profile.dto';
