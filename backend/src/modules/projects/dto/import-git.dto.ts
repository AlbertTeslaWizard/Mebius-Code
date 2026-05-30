import { IsOptional, IsString, MinLength } from 'class-validator';

export class ImportGitDto {
  @IsString()
  @MinLength(3)
  gitUrl: string;

  @IsOptional()
  @IsString()
  branch?: string;
}
