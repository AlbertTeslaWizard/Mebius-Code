import { IsString, MaxLength, MinLength } from 'class-validator';

export class GitPathDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  path: string;
}
