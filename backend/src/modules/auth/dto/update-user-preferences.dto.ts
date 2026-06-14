import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';

export class UpdateLayoutPreferencesDto {
  @IsOptional()
  @IsBoolean()
  leftSidebarCollapsed?: boolean;

  @IsOptional()
  @IsBoolean()
  rightSidebarCollapsed?: boolean;

  @IsOptional()
  @IsBoolean()
  sessionPaneCollapsed?: boolean;

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

export class UpdateThemePreferencesDto {
  @IsOptional()
  @IsIn(['dark', 'light'])
  mode?: 'dark' | 'light';
}

export class UpdateUserPreferencesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateLayoutPreferencesDto)
  layout?: UpdateLayoutPreferencesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateThemePreferencesDto)
  theme?: UpdateThemePreferencesDto;
}
