import { IsOptional, IsString, MinLength } from 'class-validator';

export class RunAgentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  message?: string;

  @IsOptional()
  @IsString()
  modelConfigId?: string;
}

