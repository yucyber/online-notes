import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: '显示名称必须是字符串' })
  @MinLength(1, { message: '显示名称不能为空' })
  @MaxLength(32, { message: '显示名称不能超过 32 个字符' })
  displayName?: string;
}

