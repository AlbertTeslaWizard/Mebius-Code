import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateSessionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title: string;
}
