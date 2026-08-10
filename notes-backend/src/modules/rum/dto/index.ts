import { IsString, IsOptional, IsNumber, IsObject } from 'class-validator'

export class RumCollectDto {
  @IsString()
  type: string

  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsNumber()
  value?: number

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>
}
