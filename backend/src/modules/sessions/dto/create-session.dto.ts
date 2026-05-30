import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSessionDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  modelConfigId?: string;
}

