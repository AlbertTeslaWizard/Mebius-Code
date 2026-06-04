import { IsString, MaxLength, MinLength } from 'class-validator';

export class RenameProjectFileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  path: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  newPath: string;
}
