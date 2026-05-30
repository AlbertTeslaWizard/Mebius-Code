import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePlanDto {
  @IsString()
  @MinLength(1)
  goal: string;

  @IsOptional()
  @IsString()
  modelConfigId?: string;
}

