import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../enums/user-role.enum';
import { LocalWorkspaceGuard } from './local-workspace.guard';

describe('LocalWorkspaceGuard', () => {
  it('rejects production mode even when the local workspace flag is enabled', () => {
    const guard = new LocalWorkspaceGuard(config({
      NODE_ENV: 'production',
      MEBIUS_CODE_LOCAL_WORKSPACES_ENABLED: 'true',
    }));

    expect(() => guard.canActivate(context(UserRole.Admin))).toThrow(ForbiddenException);
  });

  it('rejects non-admin users', () => {
    const guard = new LocalWorkspaceGuard(config({
      NODE_ENV: 'development',
      MEBIUS_CODE_LOCAL_WORKSPACES_ENABLED: 'true',
    }));

    expect(() => guard.canActivate(context(UserRole.User))).toThrow(
      'Creating local workspaces requires an administrator account.',
    );
  });

  it('allows administrators when local workspaces are explicitly enabled outside production', () => {
    const guard = new LocalWorkspaceGuard(config({
      MEBIUS_CODE_SERVER_MODE: 'local_runtime',
      MEBIUS_CODE_LOCAL_WORKSPACES_ENABLED: 'true',
    }));

    expect(guard.canActivate(context(UserRole.Admin))).toBe(true);
  });
});

function config(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

function context(role: UserRole): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user: {
          sub: 'user-1',
          email: 'user@example.com',
          role,
        },
      }),
    }),
  } as unknown as ExecutionContext;
}
