import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { RequestWithUser } from '../../common/types/request-with-user';
import { AuthService } from './auth.service';
import { LocalAuthService } from './local-auth.service';
import { LoginDto } from './dto/login.dto';
import { PairLocalDeviceDto } from './dto/pair-local-device.dto';
import { RegisterDto } from './dto/register.dto';
import { SendRegisterVerificationCodeDto } from './dto/send-register-verification-code.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly localAuth: LocalAuthService,
  ) {}

  @Post('register/verification-code')
  sendRegisterVerificationCode(@Body() dto: SendRegisterVerificationCodeDto) {
    return this.auth.sendRegisterVerificationCode(dto);
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('local/bootstrap-token')
  localBootstrapToken(@Req() request: RequestWithUser) {
    return this.localAuth.bootstrapToken(request.socket.remoteAddress);
  }

  @Post('local/pairing-codes')
  @UseGuards(JwtAuthGuard)
  createLocalPairingCode(@Req() request: RequestWithUser) {
    return this.localAuth.createPairingCode(request.user.sub);
  }

  @Post('local/pair')
  pairLocalDevice(@Body() dto: PairLocalDeviceDto) {
    return this.localAuth.pairDevice(dto.code);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() request: RequestWithUser) {
    return this.auth.currentUser(request.user.sub);
  }

  @Patch('me/preferences')
  @UseGuards(JwtAuthGuard)
  updatePreferences(@Req() request: RequestWithUser, @Body() dto: UpdateUserPreferencesDto) {
    return this.auth.updatePreferences(request.user.sub, dto);
  }

  @Patch('me/password')
  @UseGuards(JwtAuthGuard)
  updatePassword(@Req() request: RequestWithUser, @Body() dto: UpdatePasswordDto) {
    return this.auth.updatePassword(request.user.sub, dto);
  }
}
