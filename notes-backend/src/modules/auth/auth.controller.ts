import { Controller, Post, Body, Res, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CreateUserDto, LoginUserDto } from '../users/dto';
import { SendEmailCodeDto } from './dto/email-verification.dto';
import type { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setAuthCookie(res: Response, token: string) {
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('notes_token', token, {
      httpOnly: true,
      // 公网 IP 的临时 HTTP 验证需显式关闭；其他生产部署仍默认要求 HTTPS。
      secure: process.env.COOKIE_SECURE === 'false' ? false : isProduction || process.env.COOKIE_SECURE === 'true',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  @Throttle({ short: { ttl: 60_000, limit: 5 } })
  @Post('email-code')
  @HttpCode(200)
  async sendEmailCode(@Body() dto: SendEmailCodeDto) {
    await this.authService.sendEmailCode(dto.email);
    return { message: '如果该邮箱可用于注册，验证码邮件将很快送达' };
  }

  @Throttle({ short: { ttl: 3_600_000, limit: 3 } })
  @Post('register')
  async register(@Body() createUserDto: CreateUserDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.authService.register(createUserDto);
    this.setAuthCookie(res, token);
    return { user };
  }

  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  @Post('login')
  async login(@Body() loginUserDto: LoginUserDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.authService.login(loginUserDto);
    this.setAuthCookie(res, token);
    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('notes_token', { path: '/' });
    return { message: 'OK' };
  }
}
