import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { CreateUserDto, LoginUserDto } from '../users/dto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
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
    const user = await this.usersService.create(createUserDto);
    return this.toAuthResponse(user);
  }

  async login(loginUserDto: LoginUserDto) {
    const user = await this.usersService.validateUser(loginUserDto.email, loginUserDto.password);
    if (!user) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    return this.toAuthResponse(user);
  }

  async getProfile(userId: string) {
    return this.usersService.findById(userId);
  }
}
