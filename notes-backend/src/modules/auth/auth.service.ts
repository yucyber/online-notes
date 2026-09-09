import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { CreateUserDto, LoginUserDto } from '../users/dto';
import { EmailVerificationService } from './email-verification.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailVerificationService: EmailVerificationService,
  ) {}

  private toAuthResponse(user: any) {
    return {
      token: this.jwtService.sign({ email: user.email, sub: (user as any).id }),
      user: {
        id: (user as any).id,
        email: user.email,
        displayName: user.displayName,
        createdAt: (user as any).createdAt,
        updatedAt: (user as any).updatedAt,
      },
    }
  }

  async register(createUserDto: CreateUserDto) {
    const { verificationCode, ...userInput } = createUserDto;
    if (!verificationCode) {
      throw new BadRequestException('验证码无效或已过期');
    }

    await this.emailVerificationService.consumeCode(userInput.email, verificationCode);
    const user = await this.usersService.create(userInput);
    return this.toAuthResponse(user);
  }

  async sendEmailCode(email: string): Promise<void> {
    if (await this.usersService.existsByEmail(email)) {
      return;
    }
    await this.emailVerificationService.sendCode(email);
  }

  async login(loginUserDto: LoginUserDto) {
    const user = await this.usersService.validateUser(loginUserDto.email, loginUserDto.password);
    if (!user) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    return this.toAuthResponse(user);
  }

}
