import { Transform } from 'class-transformer'
import { IsString, IsOptional, IsEnum, IsArray, MaxLength, IsBoolean, IsDateString, IsInt, Min, Max, IsMongoId } from 'class-validator'

import { AiRunStatus } from '../schemas/ai-run.schema'

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

export class AiRagAnswerDto {
  @IsString()
  @MaxLength(2000)
  question: string

  @IsOptional()
  @IsMongoId()
  knowledgeBaseId?: string
}

export class AiRunPerformanceQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string

  @IsOptional()
  @IsDateString()
  to?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  task?: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  provider?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string

  @IsOptional()
  @IsEnum(['running', 'succeeded', 'failed'])
  status?: AiRunStatus

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' ? true : value === false || value === 'false' ? false : value)
  @IsBoolean()
  fallbackUsed?: boolean

  @IsOptional()
  @Transform(({ value }) => value === undefined ? 1 : Number(value))
  @IsInt()
  @Min(1)
  page = 1

  @IsOptional()
  @Transform(({ value }) => value === undefined ? 20 : Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  size = 20
}
