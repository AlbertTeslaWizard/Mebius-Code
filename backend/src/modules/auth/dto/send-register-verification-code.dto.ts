import { IsEmail } from 'class-validator';

export class SendRegisterVerificationCodeDto {
  @IsEmail()
  email: string;
}
