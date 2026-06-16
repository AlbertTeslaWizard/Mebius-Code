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
        sessionPaneCollapsed: true,
        leftSidebarWidth: 310,
        rightSidebarWidth: 480,
      },
    });
    users.findOne.mockResolvedValue(user);

    const result = await service.updatePreferences(user.id, {
      layout: { rightSidebarCollapsed: true, rightSidebarWidth: 640 },
    });

    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: {
          layout: {
            leftSidebarCollapsed: true,
            rightSidebarCollapsed: true,
            sessionPaneCollapsed: true,
            leftSidebarWidth: 310,
            rightSidebarWidth: 640,
          },
          theme: {
            mode: 'dark',
          },
        },
      }),
    );
    expect(result.preferences.layout.leftSidebarCollapsed).toBe(true);
    expect(result.preferences.layout.rightSidebarCollapsed).toBe(true);
    expect(result.preferences.layout.sessionPaneCollapsed).toBe(true);
    expect(result.preferences.layout.leftSidebarWidth).toBe(310);
    expect(result.preferences.layout.rightSidebarWidth).toBe(640);
  });

  it('normalizes missing preferences to expanded sidebars with default widths', async () => {
    const user = userFixture(undefined);
    users.findOne.mockResolvedValue(user);

    const result = await service.updatePreferences(user.id, {});

    expect(result.preferences).toEqual({
      layout: {
        leftSidebarCollapsed: false,
        rightSidebarCollapsed: false,
        sessionPaneCollapsed: false,
        leftSidebarWidth: 280,
        rightSidebarWidth: 420,
      },
      theme: {
        mode: 'dark',
      },
    });
  });

  it('normalizes invalid or missing layout widths', async () => {
    const user = userFixture({
      layout: {
        leftSidebarCollapsed: false,
        rightSidebarCollapsed: true,
        sessionPaneCollapsed: 'closed',
        leftSidebarWidth: 'wide',
        rightSidebarWidth: 9999,
      },
    });
    users.findOne.mockResolvedValue(user);

    const result = await service.updatePreferences(user.id, {});

    expect(result.preferences).toEqual({
      layout: {
        leftSidebarCollapsed: false,
        rightSidebarCollapsed: true,
        sessionPaneCollapsed: false,
        leftSidebarWidth: 280,
        rightSidebarWidth: 820,
      },
      theme: {
        mode: 'dark',
      },
    });
  });

  it('merges theme preference updates without resetting layout', async () => {
    const user = userFixture({
      layout: {
        leftSidebarCollapsed: true,
        rightSidebarCollapsed: false,
        sessionPaneCollapsed: true,
        leftSidebarWidth: 300,
        rightSidebarWidth: 620,
      },
      theme: {
        mode: 'light',
      },
    });
    users.findOne.mockResolvedValue(user);

    const result = await service.updatePreferences(user.id, {
      theme: { mode: 'dark' },
    });

    expect(result.preferences).toEqual({
      layout: {
        leftSidebarCollapsed: true,
        rightSidebarCollapsed: false,
        sessionPaneCollapsed: true,
        leftSidebarWidth: 300,
        rightSidebarWidth: 620,
      },
      theme: {
        mode: 'dark',
      },
    });
  });
});

function userFixture(preferences: unknown): User {
  const createdAt = new Date('2026-06-01T00:00:00.000Z');
  return {
    id: 'user-1',
    email: 'user@example.com',
    nickname: 'Test User',
    passwordHash: 'hash',
    role: UserRole.User,
    preferences: preferences as User['preferences'],
    createdAt,
    updatedAt: createdAt,
  } as User;
}
