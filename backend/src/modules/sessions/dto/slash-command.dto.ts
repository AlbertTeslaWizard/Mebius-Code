import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class SlashCommandDto {
  @IsString()
  @MinLength(1)
  command: string;

  @IsOptional()
  @IsObject()
  args?: Record<string, unknown>;
}

