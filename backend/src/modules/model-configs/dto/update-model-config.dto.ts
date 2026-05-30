import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

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

  @IsOptional()
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

