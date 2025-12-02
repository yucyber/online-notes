import { IsString, IsOptional } from 'class-validator';

export class CreateTagDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  color?: string = '#6B7280';
}

export class UpdateTagDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  color?: string;
}