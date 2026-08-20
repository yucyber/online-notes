import { IsString, IsOptional, IsNumber, MaxLength } from 'class-validator'

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
}

export class CreateReplyDto {
  @IsString()
  @MaxLength(2000)
  text: string
}
