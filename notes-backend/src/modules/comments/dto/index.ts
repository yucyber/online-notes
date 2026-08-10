import { IsString, IsOptional, IsNumber, MaxLength, IsObject } from 'class-validator'

export class CreateCommentDto {
  @IsString()
  @MaxLength(2000)
  text: string

  @IsOptional()
  @IsNumber()
  start?: number

  @IsOptional()
  @IsNumber()
  end?: number

  @IsOptional()
  @IsString()
  blockId?: string

  @IsOptional()
  @IsObject()
  anchor?: Record<string, unknown>
}

export class CreateReplyDto {
  @IsString()
  @MaxLength(2000)
  text: string
}
