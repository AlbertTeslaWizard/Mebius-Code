import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { ActiveSkillDto } from './run-agent.dto';

export class RevisePlanDto {
  @IsString()
  @MinLength(1)
  instruction: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ActiveSkillDto)
  activeSkills?: ActiveSkillDto[];
}
