import { ConfigService } from '@nestjs/config';
import { SystemService } from './system.service';

describe('SystemService', () => {
  it('reports local workspaces disabled in production even when the env flag is true', () => {
    const service = new SystemService(config({
      NODE_ENV: 'production',
      MEBIUS_CODE_LOCAL_WORKSPACES_ENABLED: 'true',
    }));

    expect(service.capabilities()).toEqual(
      expect.objectContaining({
        serverMode: 'production',
        localWorkspacesEnabled: false,
      }),
    );
  });

  it('reports local workspaces enabled for an explicitly enabled local runtime', () => {
    const service = new SystemService(config({
      MEBIUS_CODE_SERVER_MODE: 'local_runtime',
      MEBIUS_CODE_LOCAL_WORKSPACES_ENABLED: 'true',
    }));

    expect(service.capabilities()).toEqual(
      expect.objectContaining({
        serverMode: 'local_runtime',
        localWorkspacesEnabled: true,
      }),
    );
  });
});

function config(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}
