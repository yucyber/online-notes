import { IsString, IsOptional, IsMongoId, ValidateIf } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  color?: string = '#3B82F6';

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsMongoId()
  parentId?: string | null;
}

export class UpdateCategoryDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsMongoId()
  parentId?: string | null;
}