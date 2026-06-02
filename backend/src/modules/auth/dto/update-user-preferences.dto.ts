import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';

export class UpdateLayoutPreferencesDto {
  @IsOptional()
  @IsBoolean()
  leftSidebarCollapsed?: boolean;

  @IsOptional()
  @IsBoolean()
  rightSidebarCollapsed?: boolean;
}

export class UpdateUserPreferencesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateLayoutPreferencesDto)
  layout?: UpdateLayoutPreferencesDto;
}
