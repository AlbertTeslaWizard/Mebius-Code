import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import { UserRole } from '../../common/enums/user-role.enum';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';

describe('AuthService', () => {
  const createdAt = new Date('2026-06-01T00:00:00.000Z');
  const users = {
    create: jest.fn(async (input: Partial<User>) => userFixture(input)),
    findByIdWithPassword: jest.fn(),
    updatePasswordHash: jest.fn(),
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
      nickname: 'Test User',
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
        nickname: 'Test User',
        role: UserRole.User,
      }),
    );
    expect(result.accessToken).toBe('jwt-token');
  });

  it('keeps admin invite code registration behavior', async () => {
    await service.register({
      email: 'admin@example.com',
      nickname: 'Admin User',
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

  it('updates password after verifying the current password', async () => {
    users.findByIdWithPassword.mockResolvedValue(
      userFixture({ passwordHash: await hash('old-secret', 12) }),
    );

    await expect(
      service.updatePassword('user-1', {
        currentPassword: 'old-secret',
        newPassword: 'new-secret',
      }),
    ).resolves.toEqual({ changed: true });

    expect(users.findByIdWithPassword).toHaveBeenCalledWith('user-1');
    expect(users.updatePasswordHash).toHaveBeenCalledWith('user-1', expect.any(String));
  });

  it('rejects password updates when the current password is wrong', async () => {
    users.findByIdWithPassword.mockResolvedValue(
      userFixture({ passwordHash: await hash('old-secret', 12) }),
    );

    await expect(
      service.updatePassword('user-1', {
        currentPassword: 'wrong-secret',
        newPassword: 'new-secret',
      }),
    ).rejects.toThrow('Current password is incorrect.');
    expect(users.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('rejects password updates that reuse the current password', async () => {
    await expect(
      service.updatePassword('user-1', {
        currentPassword: 'same-secret',
        newPassword: 'same-secret',
      }),
    ).rejects.toThrow('New password must be different');
    expect(users.findByIdWithPassword).not.toHaveBeenCalled();
    expect(users.updatePasswordHash).not.toHaveBeenCalled();
  });

  function userFixture(input: Partial<User>): User {
    return {
      id: 'user-1',
      email: input.email ?? 'user@example.com',
      nickname: input.nickname ?? 'Test User',
      passwordHash: input.passwordHash ?? 'hash',
      role: input.role ?? UserRole.User,
      preferences: {},
      createdAt,
      updatedAt: createdAt,
    } as User;
  }
});
