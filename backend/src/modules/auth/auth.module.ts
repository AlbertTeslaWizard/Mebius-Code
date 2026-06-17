import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationCode } from './email-verification-code.entity';
import { EmailVerificationService } from './email-verification.service';
import { JwtStrategy } from './jwt.strategy';
import { LocalAuthService } from './local-auth.service';
import { LocalPairingService } from './local-pairing.service';
import { MailService } from './mail.service';
import { SseJwtGuard } from './sse-jwt.guard';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    TypeOrmModule.forFeature([EmailVerificationCode]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'mebius-code-dev-jwt-secret',
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '7d',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    EmailVerificationService,
    LocalAuthService,
    LocalPairingService,
    MailService,
    JwtStrategy,
    SseJwtGuard,
  ],
  exports: [AuthService, JwtModule, SseJwtGuard],
})
export class AuthModule {}
