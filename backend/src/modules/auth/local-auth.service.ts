import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { UserRole } from '../../common/enums/user-role.enum';
import { localAuthEnabled } from '../../common/system/server-capabilities';
import type { JwtPayload } from '../../common/types/authenticated-user';
import type { User } from '../users/user.entity';
import { normalizeUserPreferences } from '../users/user-preferences';
import { UsersService } from '../users/users.service';
import type { PublicUser } from './auth.service';
import { LocalPairingService } from './local-pairing.service';

const LOCAL_OWNER_EMAIL = 'local@mebius.local';
const LOCAL_OWNER_NICKNAME = 'Local Owner';

@Injectable()
export class LocalAuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly pairing: LocalPairingService,
  ) {}

  async bootstrapToken(remoteAddress: string | undefined): Promise<{
    user: PublicUser;
    accessToken: string;
  }> {
    this.assertLocalAuthEnabled();
    if (!isLoopbackAddress(remoteAddress)) {
      throw new ForbiddenException('Local owner bootstrap is available only from this machine.');
    }
    return this.authResponse(await this.ensureLocalOwner());
  }

  async createPairingCode(userId: string): Promise<{ code: string; expiresInSeconds: number }> {
    this.assertLocalAuthEnabled();
    const user = await this.users.findById(userId);
    if (user.role !== UserRole.Admin) {
      throw new ForbiddenException('Only a local admin can create device pairing codes.');
    }
    return this.pairing.create(user.id);
  }

  async pairDevice(code: string): Promise<{ user: PublicUser; accessToken: string }> {
    this.assertLocalAuthEnabled();
    const ownerId = await this.pairing.consume(code);
    return this.authResponse(await this.users.findById(ownerId));
  }

  private async ensureLocalOwner(): Promise<User> {
    const existingOwner = await this.users.findByEmail(LOCAL_OWNER_EMAIL);
    if (existingOwner) {
      if (existingOwner.role !== UserRole.Admin) {
        throw new ForbiddenException('Local owner account exists but is not an admin.');
      }
      return existingOwner;
    }

    if ((await this.users.count()) > 0) {
      throw new ForbiddenException(
        'Local owner bootstrap is available only before any account exists. Sign in with an existing account.',
      );
    }

    return this.users.create({
      email: LOCAL_OWNER_EMAIL,
      nickname: LOCAL_OWNER_NICKNAME,
      passwordHash: await hash(randomBytes(32).toString('hex'), 12),
      role: UserRole.Admin,
    });
  }

  private assertLocalAuthEnabled(): void {
    if (!localAuthEnabled(this.config)) {
      throw new ForbiddenException('Local authentication is not enabled on this backend.');
    }
  }

  private async authResponse(user: User): Promise<{ user: PublicUser; accessToken: string }> {
    return {
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        role: user.role,
        preferences: normalizeUserPreferences(user.preferences),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      accessToken: await this.sign(user),
    };
  }

  private sign(user: User): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return this.jwt.signAsync(payload);
  }
}

function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) return false;
  return (
    value === '127.0.0.1' ||
    value === '::1' ||
    value === '::ffff:127.0.0.1' ||
    value === 'localhost'
  );
}
