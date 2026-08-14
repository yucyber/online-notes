import { Body, Controller, Patch, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UpdateProfileDto } from './dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AuthGuard('jwt'))
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch('me')
  updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    // userId 只能来自 JWT，避免客户端借由请求体修改其他账户。
    return this.usersService.updateProfile(req.user.id, dto);
  }
}

