import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../../common/enums/user-role.enum';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { LocalAuthService } from './local-auth.service';
import { LocalPairingService } from './local-pairing.service';

describe('LocalAuthService', () => {
  const createdAt = new Date('2026-06-01T00:00:00.000Z');
  const users = {
    count: jest.fn(),
    create: jest.fn(async (input: Partial<User>) => userFixture(input)),
    findByEmail: jest.fn(),
    findById: jest.fn(),
  } as unknown as jest.Mocked<UsersService>;
  const jwt = {
    signAsync: jest.fn(async () => 'local-jwt-token'),
  } as unknown as jest.Mocked<JwtService>;
  const pairing = {
    create: jest.fn(async () => ({ code: '123456', expiresInSeconds: 300 })),
    consume: jest.fn(async () => 'owner-1'),
  } as unknown as jest.Mocked<LocalPairingService>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('bootstraps a local admin from loopback when no users exist', async () => {
    const service = new LocalAuthService(users, jwt, config({ MEBIUS_CODE_SERVER_MODE: 'local_runtime' }), pairing);
    users.findByEmail.mockResolvedValue(null);
    users.count.mockResolvedValue(0);

    const result = await service.bootstrapToken('127.0.0.1');

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'local@mebius.local',
        nickname: 'Local Owner',
        role: UserRole.Admin,
      }),
    );
    expect(result.user.role).toBe(UserRole.Admin);
    expect(result.accessToken).toBe('local-jwt-token');
  });

  it('reuses the existing local owner on later bootstrap requests', async () => {
    const service = new LocalAuthService(users, jwt, config({ MEBIUS_CODE_SERVER_MODE: 'local_runtime' }), pairing);
    users.findByEmail.mockResolvedValue(userFixture({ email: 'local@mebius.local', role: UserRole.Admin }));

    await service.bootstrapToken('::1');

    expect(users.count).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ email: 'local@mebius.local' }));
  });

  it('rejects local owner bootstrap from non-loopback clients', async () => {
    const service = new LocalAuthService(users, jwt, config({ MEBIUS_CODE_SERVER_MODE: 'local_runtime' }), pairing);

    await expect(service.bootstrapToken('192.168.1.50')).rejects.toThrow('only from this machine');
    expect(users.create).not.toHaveBeenCalled();
  });

  it('keeps local authentication disabled in production', async () => {
    const service = new LocalAuthService(users, jwt, config({ NODE_ENV: 'production' }), pairing);

    await expect(service.bootstrapToken('127.0.0.1')).rejects.toThrow('not enabled');
    expect(users.create).not.toHaveBeenCalled();
  });

  it('creates pairing codes only for admins', async () => {
    const service = new LocalAuthService(users, jwt, config({ MEBIUS_CODE_SERVER_MODE: 'local_runtime' }), pairing);
    users.findById.mockResolvedValue(userFixture({ id: 'owner-1', role: UserRole.Admin }));

    await expect(service.createPairingCode('owner-1')).resolves.toEqual({
      code: '123456',
      expiresInSeconds: 300,
    });
    expect(pairing.create).toHaveBeenCalledWith('owner-1');

    users.findById.mockResolvedValue(userFixture({ id: 'user-2', role: UserRole.User }));
    await expect(service.createPairingCode('user-2')).rejects.toThrow('Only a local admin');
  });

  it('exchanges a valid pairing code for an auth token', async () => {
    const service = new LocalAuthService(users, jwt, config({ MEBIUS_CODE_SERVER_MODE: 'local_runtime' }), pairing);
    users.findById.mockResolvedValue(userFixture({ id: 'owner-1', role: UserRole.Admin }));

    const result = await service.pairDevice('123456');

    expect(pairing.consume).toHaveBeenCalledWith('123456');
    expect(result.user.id).toBe('owner-1');
    expect(result.accessToken).toBe('local-jwt-token');
  });

  function userFixture(input: Partial<User>): User {
    return {
      id: input.id ?? 'owner-1',
      email: input.email ?? 'owner@example.com',
      nickname: input.nickname ?? 'Local Owner',
      passwordHash: input.passwordHash ?? 'hash',
      role: input.role ?? UserRole.Admin,
      preferences: {},
      createdAt,
      updatedAt: createdAt,
    } as User;
  }
});

function config(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}
