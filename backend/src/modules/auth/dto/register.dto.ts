import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'verificationCode must be a 6-digit code' })
  verificationCode: string;

  @IsOptional()
  @IsString()
  adminInviteCode?: string;
}
