import { Repository } from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum';
import { User } from './user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const users = {
    findOne: jest.fn(),
    save: jest.fn((input: User) => Promise.resolve(input)),
  } as unknown as jest.Mocked<Repository<User>>;
  const service = new UsersService(users);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('merges layout preference updates without resetting other values', async () => {
    const user = userFixture({
      layout: {
        leftSidebarCollapsed: true,
        rightSidebarCollapsed: false,
      },
    });
    users.findOne.mockResolvedValue(user);

    const result = await service.updatePreferences(user.id, {
      layout: { rightSidebarCollapsed: true },
    });

    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: {
          layout: {
            leftSidebarCollapsed: true,
            rightSidebarCollapsed: true,
          },
        },
      }),
    );
    expect(result.preferences.layout.leftSidebarCollapsed).toBe(true);
    expect(result.preferences.layout.rightSidebarCollapsed).toBe(true);
  });

  it('normalizes missing preferences to expanded sidebars', async () => {
    const user = userFixture(undefined);
    users.findOne.mockResolvedValue(user);

    const result = await service.updatePreferences(user.id, {});

    expect(result.preferences).toEqual({
      layout: {
        leftSidebarCollapsed: false,
        rightSidebarCollapsed: false,
      },
    });
  });
});

function userFixture(preferences: User['preferences'] | undefined): User {
  const createdAt = new Date('2026-06-01T00:00:00.000Z');
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Test User',
    passwordHash: 'hash',
    role: UserRole.User,
    preferences,
    createdAt,
    updatedAt: createdAt,
  } as User;
}
