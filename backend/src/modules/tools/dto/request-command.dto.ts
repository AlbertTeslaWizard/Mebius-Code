import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RequestCommandDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  command: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cwd?: string;
}
