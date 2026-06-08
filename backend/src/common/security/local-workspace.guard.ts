import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { localWorkspacesEnabled, resolveServerMode } from '../system/server-capabilities';
import { UserRole } from '../enums/user-role.enum';
import { RequestWithUser } from '../types/request-with-user';

@Injectable()
export class LocalWorkspaceGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const serverMode = resolveServerMode(this.config);
    if (!localWorkspacesEnabled(this.config)) {
      throw new ForbiddenException(
        serverMode === 'production'
          ? 'Local workspaces are disabled in production mode.'
          : 'Local workspaces are disabled on this backend.',
      );
    }

    if (request.user.role !== UserRole.Admin) {
      throw new ForbiddenException('Creating local workspaces requires an administrator account.');
    }

    return true;
  }
}
