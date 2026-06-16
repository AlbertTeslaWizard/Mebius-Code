import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtPayload } from '../../common/types/authenticated-user';
import { User } from '../users/user.entity';
import {
  normalizeUserPreferences,
  UserPreferences,
  UserPreferencesPatch,
} from '../users/user-preferences';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SendRegisterVerificationCodeDto } from './dto/send-register-verification-code.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { EmailVerificationService } from './email-verification.service';

export interface PublicUser {
  id: string;
  email: string;
  nickname: string;
  role: UserRole;
  preferences: UserPreferences;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly verification: EmailVerificationService,
  ) {}

  async sendRegisterVerificationCode(dto: SendRegisterVerificationCodeDto): Promise<{
    sent: true;
    expiresInSeconds: number;
    resendAfterSeconds: number;
  }> {
    return this.verification.sendRegisterCode(dto.email);
  }

  async register(dto: RegisterDto): Promise<{ user: PublicUser; accessToken: string }> {
    await this.verification.verifyAndConsumeRegisterCode(dto.email, dto.verificationCode);
    const passwordHash = await hash(dto.password, 12);
    const adminInviteCode = this.config.get<string>('ADMIN_INVITE_CODE');
    const role =
      adminInviteCode && dto.adminInviteCode === adminInviteCode ? UserRole.Admin : UserRole.User;
    const user = await this.users.create({
      email: dto.email,
      nickname: dto.nickname,
      passwordHash,
      role,
    });
    return { user: this.publicUser(user), accessToken: await this.sign(user) };
  }

  async login(dto: LoginDto): Promise<{ user: PublicUser; accessToken: string }> {
    const user = await this.users.findByEmailWithPassword(dto.email);
    if (!user || !(await compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return { user: this.publicUser(user), accessToken: await this.sign(user) };
  }

  async currentUser(userId: string): Promise<PublicUser> {
    return this.publicUser(await this.users.findById(userId));
  }

  async updatePreferences(userId: string, patch: UserPreferencesPatch): Promise<PublicUser> {
    return this.publicUser(await this.users.updatePreferences(userId, patch));
  }

  async updatePassword(userId: string, dto: UpdatePasswordDto): Promise<{ changed: true }> {
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different from the current password.');
    }
    const user = await this.users.findByIdWithPassword(userId);
    if (!(await compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    await this.users.updatePasswordHash(user.id, await hash(dto.newPassword, 12));
    return { changed: true };
  }

  async sign(user: User): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return this.jwt.signAsync(payload);
  }

  private publicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      role: user.role,
      preferences: normalizeUserPreferences(user.preferences),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
