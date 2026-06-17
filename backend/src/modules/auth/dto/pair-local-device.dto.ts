import { IsString, Matches } from 'class-validator';

export class PairLocalDeviceDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit code' })
  code: string;
}
