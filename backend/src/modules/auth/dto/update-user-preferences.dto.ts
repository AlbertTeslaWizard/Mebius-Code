import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';

export class UpdateLayoutPreferencesDto {
  @IsOptional()
  @IsBoolean()
  leftSidebarCollapsed?: boolean;

  @IsOptional()
  @IsBoolean()
  rightSidebarCollapsed?: boolean;

  @IsOptional()
  @IsInt()
  @Min(220)
  @Max(420)
  leftSidebarWidth?: number;

  @IsOptional()
  @IsInt()
  @Min(320)
  @Max(820)
  rightSidebarWidth?: number;
}

export class UpdateUserPreferencesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateLayoutPreferencesDto)
  layout?: UpdateLayoutPreferencesDto;
}
