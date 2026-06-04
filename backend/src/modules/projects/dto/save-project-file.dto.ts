import { IsString, MaxLength, MinLength } from 'class-validator';

export class SaveProjectFileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  path: string;

  @IsString()
  @MaxLength(512 * 1024)
  content: string;
}
