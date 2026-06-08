import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../../common/enums/user-role.enum';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';

describe('AuthService', () => {
  const createdAt = new Date('2026-06-01T00:00:00.000Z');
  const users = {
    create: jest.fn(async (input: Partial<User>) => userFixture(input)),
  } as unknown as jest.Mocked<UsersService>;
  const jwt = {
    signAsync: jest.fn(async () => 'jwt-token'),
  } as unknown as jest.Mocked<JwtService>;
  const config = {
    get: jest.fn((key: string) => (key === 'ADMIN_INVITE_CODE' ? 'admin-secret' : undefined)),
  } as unknown as jest.Mocked<ConfigService>;
  const verification = {
    sendRegisterCode: jest.fn(),
    verifyAndConsumeRegisterCode: jest.fn(),
  } as unknown as jest.Mocked<EmailVerificationService>;
  const service = new AuthService(users, jwt, config, verification);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('verifies the email code before creating an account', async () => {
    const result = await service.register({
      email: 'user@example.com',
      name: 'Test User',
      password: 'secret123',
      verificationCode: '123456',
    });

    expect(verification.verifyAndConsumeRegisterCode).toHaveBeenCalledWith(
      'user@example.com',
      '123456',
    );
    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'user@example.com',
        name: 'Test User',
        role: UserRole.User,
      }),
    );
    expect(result.accessToken).toBe('jwt-token');
  });

  it('keeps admin invite code registration behavior', async () => {
    await service.register({
      email: 'admin@example.com',
      name: 'Admin User',
      password: 'secret123',
      verificationCode: '123456',
      adminInviteCode: 'admin-secret',
    });

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        role: UserRole.Admin,
      }),
    );
  });

  function userFixture(input: Partial<User>): User {
    return {
      id: 'user-1',
      email: input.email ?? 'user@example.com',
      name: input.name ?? 'Test User',
      passwordHash: input.passwordHash ?? 'hash',
      role: input.role ?? UserRole.User,
      preferences: {},
      createdAt,
      updatedAt: createdAt,
    } as User;
  }
});
