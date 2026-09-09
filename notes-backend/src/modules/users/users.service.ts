import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto, UpdateProfileDto } from './dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create({ email, password }: Pick<CreateUserDto, 'email' | 'password'>): Promise<User> {
    const existingUser = await this.userModel.findOne({ email });
    if (existingUser) {
      throw new ConflictException('该邮箱已被注册');
    }

    const createdUser = new this.userModel({ email, password });
    return createdUser.save();
  }

  async existsByEmail(email: string): Promise<boolean> {
    const normalizedEmail = email.trim().toLowerCase();
    return Boolean(await this.userModel.findOne({ email: normalizedEmail }));
  }

  async findByEmail(email: string): Promise<UserDocument> {
    const normalizedEmail = email.trim().toLowerCase();
    let user = await this.userModel.findOne({ email: normalizedEmail });
    // 新注册邮箱已统一小写；仅在精确查询缺失时兼容历史大小写，且不让邮箱字符改变匹配范围。
    if (!user) {
      const escapedEmail = normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      user = await this.userModel.findOne({ email: new RegExp(`^${escapedEmail}$`, 'i') });
    }
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return user;
  }

  async findById(id: string): Promise<User> {
    const user = await this.userModel.findById(id).select('-password');
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return user;
  }

  async validateUser(email: string, password: string): Promise<User | null> {
    try {
      const user = await this.findByEmail(email);
      if (user && typeof (user as any).comparePassword === 'function') {
        const isPasswordValid = await (user as any).comparePassword(password);
        if (isPasswordValid) {
          return user;
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<User> {
    const user = await this.userModel.findById(userId).select('-password');
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (dto.displayName !== undefined) {
      user.displayName = dto.displayName;
    }

    const savedUser = await user.save();
    return typeof savedUser.toJSON === 'function' ? savedUser.toJSON() as User : savedUser;
  }
}
