import { IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

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
