import { Type } from 'class-transformer'
import { IsArray, IsIn, IsMongoId, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator'

export class CreateKnowledgeBaseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string
}

export class UpdateKnowledgeBaseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string
}

export class AddKnowledgeBaseNoteDto {
  @IsMongoId()
  noteId: string
}

export class KnowledgeGraphNodeDto {
  @IsString()
  @MaxLength(160)
  id: string

  @IsString()
  @MaxLength(160)
  label: string

  @IsIn(['concept', 'entity', 'topic', 'claim'])
  type: 'concept' | 'entity' | 'topic' | 'claim'

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number

  @IsArray()
  @IsMongoId({ each: true })
  noteIds: string[]

  @IsOptional()
  @IsArray()
  evidenceChunkIds?: string[]
}

export class KnowledgeGraphEdgeDto {
  @IsString()
  @MaxLength(200)
  id: string

  @IsString()
  @MaxLength(160)
  source: string

  @IsString()
  @MaxLength(160)
  target: string

  @IsString()
  @MaxLength(120)
  relation: string

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  weight?: number

  @IsArray()
  @IsMongoId({ each: true })
  noteIds: string[]

  @IsOptional()
  @IsArray()
  evidenceChunkIds?: string[]
}

export class SaveKnowledgeGraphDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KnowledgeGraphNodeDto)
  nodes: KnowledgeGraphNodeDto[]

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KnowledgeGraphEdgeDto)
  edges: KnowledgeGraphEdgeDto[]
}
