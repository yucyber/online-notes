import { IsString, IsOptional, IsEnum, IsArray, MaxLength } from 'class-validator'

export class AiWriterDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  prompt?: string

  @IsString()
  @MaxLength(100000)
  context: string

  @IsEnum(['continue', 'polish', 'summary'])
  type: 'continue' | 'polish' | 'summary'
}

export class AiSummaryDto {
  @IsArray()
  notes: any[]
}
