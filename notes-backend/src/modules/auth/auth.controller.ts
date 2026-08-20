import { Controller, Post, Body, Res, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CreateUserDto, LoginUserDto } from '../users/dto';
import type { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setAuthCookie(res: Response, token: string) {
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('notes_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
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
