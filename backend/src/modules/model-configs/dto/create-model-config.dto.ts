import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class CreateModelConfigDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName: string;

  @IsUrl({ require_tld: false })
  baseUrl: string;

  @IsString()
  @MinLength(1)
  modelName: string;

  @IsString()
  @MinLength(1)
  apiKey: string;

  @IsOptional()
  @IsBoolean()
  supportsTools?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

