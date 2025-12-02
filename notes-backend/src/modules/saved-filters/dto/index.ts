import { IsString, IsNotEmpty, IsObject } from 'class-validator';

export class CreateSavedFilterDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsObject()
  criteria: any;
}
