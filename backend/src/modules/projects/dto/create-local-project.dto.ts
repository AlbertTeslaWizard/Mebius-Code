import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLocalProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  path: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;
}
