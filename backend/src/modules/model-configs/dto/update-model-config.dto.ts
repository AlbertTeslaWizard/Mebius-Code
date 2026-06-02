import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpdateModelConfigDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  modelName?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== '')
  @IsString()
  @MinLength(1)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  supportsTools?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
