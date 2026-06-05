import { ArrayUnique, IsArray, IsString, MaxLength } from 'class-validator';

export class UpdateCommandPolicyDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  enabledPresets: string[];

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  customCommands: string[];
}
