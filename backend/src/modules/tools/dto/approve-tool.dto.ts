import { IsIn, IsOptional } from 'class-validator';

export class ApproveToolDto {
  @IsOptional()
  @IsIn(['once', 'project', 'session_auto'])
  mode?: 'once' | 'project' | 'session_auto';
}
