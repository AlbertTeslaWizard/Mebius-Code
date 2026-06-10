import { IsArray } from 'class-validator';
import type { PlanQuestionAnswer } from '../plan-workflow.types';

export class UpdatePlanAnswersDto {
  @IsArray()
  answers: PlanQuestionAnswer[];
}
