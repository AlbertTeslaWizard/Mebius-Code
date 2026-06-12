import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  localWorkspacesEnabled,
  PROJECT_SOURCE_TYPES,
  resolveServerMode,
  WORKSPACE_MODES,
} from '../../common/system/server-capabilities';

@Injectable()
export class SystemService {
  constructor(private readonly config: ConfigService) {}

  capabilities() {
    const serverMode = resolveServerMode(this.config);
    return {
      version: '0.1.0',
      serverMode,
      localWorkspacesEnabled: localWorkspacesEnabled(this.config),
      workspaceModes: WORKSPACE_MODES,
      sourceTypes: PROJECT_SOURCE_TYPES,
      features: {
        localWorkspaces: localWorkspacesEnabled(this.config),
        sseSessionEvents: true,
        planMode: true,
        toolApprovals: true,
        commandApprovals: true,
        mcpTools: true,
      },
    };
  }
}
