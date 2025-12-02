import { IsString, IsOptional, IsArray, IsMongoId, IsEnum, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer'

export enum NoteStatus {
  PUBLISHED = 'published',
  DRAFT = 'draft',
}

export enum TagsMode {
  ANY = 'any',
  ALL = 'all',
}

export enum CategoriesMode {
  ANY = 'any',
  ALL = 'all',
}

export class CreateNoteDto {
  @IsString({ message: '标题必须是字符串' })
  title: string;

  @IsString({ message: '内容必须是字符串' })
  content: string;

  @IsOptional()
  @IsMongoId({ message: '分类ID格式不正确' })
  categoryId?: string;

  @IsOptional()
  @IsArray({ message: '分类必须是数组' })
  @IsMongoId({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray({ message: '标签必须是数组' })
  tags: string[] = [];

  @IsOptional()
  @IsEnum(NoteStatus, { message: '状态必须是 published 或 draft' })
  status?: NoteStatus;
}

export class UpdateNoteDto {
  @IsOptional()
  @IsString({ message: '标题必须是字符串' })
  title?: string;

  @IsOptional()
  @IsString({ message: '内容必须是字符串' })
  content?: string;

  @IsOptional()
  @IsMongoId({ message: '分类ID格式不正确' })
  categoryId?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined
    return Array.isArray(value) ? value : [value]
  })
  @IsMongoId({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray({ message: '标签必须是数组' })
  tags?: string[];

  @IsOptional()
  @IsEnum(NoteStatus, { message: '状态必须是 published 或 draft' })
  status?: NoteStatus;
}

export class NoteFilterDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined
    return Array.isArray(value) ? value : [value]
  })
  @IsMongoId({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined
    return Array.isArray(value) ? value : [value]
  })
  @IsMongoId({ each: true })
  tagIds?: string[];

  @IsOptional()
  @IsEnum(TagsMode)
  tagsMode?: TagsMode;

  @IsOptional()
  @IsEnum(CategoriesMode)
  categoriesMode?: CategoriesMode;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(NoteStatus)
  status?: NoteStatus;
}
