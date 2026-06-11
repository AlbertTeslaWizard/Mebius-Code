import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class ActiveSkillDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsIn(['workspace', 'user', 'opencode', 'claude', 'mebius', 'custom'])
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  skillFile?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(30000)
  content!: string;
}

export class RunAgentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  message?: string;

  @IsOptional()
  @IsString()
  modelConfigId?: string;

  @IsOptional()
  @IsString()
  approvedPlanId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ActiveSkillDto)
  activeSkills?: ActiveSkillDto[];
}
