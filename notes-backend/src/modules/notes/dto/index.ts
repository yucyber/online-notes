import { IsString, IsOptional, IsArray, IsMongoId, IsEnum, IsDateString, IsInt, Min, Max, IsIn, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer'

export enum NoteStatus {
  PUBLISHED = 'published',
  DRAFT = 'draft',
}

export enum NoteVisibility {
  PRIVATE = 'private',
  PUBLIC = 'public',
}

export enum TagsMode {
  ANY = 'any',
  ALL = 'all',
}

// 搜索模式：支持文本索引与正则
export enum SearchMode {
  TEXT = 'text',
  REGEX = 'regex',
}

export class CreateNoteDto {
  @IsString({ message: '标题必须是字符串' })
  @MaxLength(200, { message: '标题不能超过 200 字符' })
  title: string;

  @IsString({ message: '内容必须是字符串' })
  @MaxLength(500000, { message: '内容不能超过 500000 字符' })
  content: string;

  @IsOptional()
  @IsMongoId({ message: '分类ID格式不正确' })
  categoryId?: string;

  @IsOptional()
  @IsArray({ message: '标签必须是数组' })
  @IsMongoId({ each: true })
  tags: string[] = [];

  @IsOptional()
  @IsEnum(NoteStatus, { message: '状态必须是 published 或 draft' })
  status?: NoteStatus;

  @IsOptional()
  @IsEnum(NoteVisibility, { message: '可见性必须是 private/public' })
  visibility?: NoteVisibility;
}

export class UpdateNoteDto {
  @IsOptional()
  @IsString({ message: '标题必须是字符串' })
  @MaxLength(200, { message: '标题不能超过 200 字符' })
  title?: string;

  @IsOptional()
  @IsString({ message: '内容必须是字符串' })
  @MaxLength(500000, { message: '内容不能超过 500000 字符' })
  content?: string;

  @IsOptional()
  @IsMongoId({ message: '分类ID格式不正确' })
  categoryId?: string;

  @IsOptional()
  @IsArray({ message: '标签必须是数组' })
  @IsMongoId({ each: true })
  tags?: string[];

  @IsOptional()
  @IsEnum(NoteStatus, { message: '状态必须是 published 或 draft' })
  status?: NoteStatus;

  @IsOptional()
  @IsEnum(NoteVisibility, { message: '可见性必须是 private/public' })
  visibility?: NoteVisibility;
}

export class NoteFilterDto {
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '搜索关键字不能超过 100 字符' })
  keyword?: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined
    return Array.isArray(value) ? value : String(value).split(',').filter(Boolean)
  })
  ids?: string[];

  // 搜索模式（默认 regex）；当为 text 时，使用 `$text` 查询以利用文本索引
  @IsOptional()
  @IsEnum(SearchMode)
  searchMode?: SearchMode;

  @IsOptional()
  @IsMongoId()
  categoryId?: string;

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
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(NoteStatus)
  status?: NoteStatus;

  // Pagination & Sorting
  @IsOptional()
  @Transform(({ value }) => value === undefined ? undefined : parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => value === undefined ? undefined : parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  // 兼容 size 别名
  @IsOptional()
  @Transform(({ value }) => value === undefined ? undefined : parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  // Cursor-based pagination：基于 `createdAt` 的时间游标
  @IsOptional()
  @IsDateString()
  cursor?: string;
}

export class RecommendationQueryDto extends NoteFilterDto {
  @IsOptional()
  @IsMongoId()
  currentNoteId?: string;
}
