import { IsIn, IsOptional } from 'class-validator';

export class ApproveToolDto {
  @IsOptional()
  @IsIn(['once', 'project'])
  mode?: 'once' | 'project';
}
