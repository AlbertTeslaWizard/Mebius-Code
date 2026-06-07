import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { CommandPolicyConfig } from './command-policy-config.entity';
import { CommandPolicyService } from './command-policy.service';
import { ProjectCommandPermission } from './project-command-permission.entity';

describe('CommandPolicyService', () => {
  const configs = {
    create: jest.fn((value) => value),
    findOne: jest.fn(),
    save: jest.fn(async (value) => value),
  } as unknown as jest.Mocked<Repository<CommandPolicyConfig>>;
  const projectPermissions = {
    create: jest.fn((value) => value),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(async (value) => value),
  } as unknown as jest.Mocked<Repository<ProjectCommandPermission>>;
  const service = new CommandPolicyService(
    {
      get: (key: string) =>
        key === 'MEBIUS_CODE_COMMAND_ALLOWLIST' ? 'git status,npm test,npm run build' : undefined,
    } as ConfigService,
    configs,
    projectPermissions,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    configs.create.mockImplementation((value) => value as CommandPolicyConfig);
    configs.findOne.mockResolvedValue(null);
    projectPermissions.find.mockResolvedValue([]);
    projectPermissions.findOne.mockResolvedValue(null);
  });

  it('accepts environment allowlisted commands', async () => {
    await expect(service.parse('npm run build')).resolves.toEqual({
      command: 'npm',
      args: ['run', 'build'],
      executionMode: 'argv',
    });
  });

  it('enables Python commands through the Python preset', async () => {
    configs.findOne.mockResolvedValue({
      id: 'global',
      enabledPresets: ['python'],
      customCommands: [],
      updatedAt: new Date(),
    });

    await expect(service.inspect('python --version')).resolves.toMatchObject({
      allowed: true,
      source: 'preset',
      command: 'python',
      args: ['--version'],
    });
  });

  it('rejects commands outside the configured policy', async () => {
    await expect(service.parse('rm -rf .')).rejects.toThrow(BadRequestException);
  });

  it('classifies command chaining as shell execution requiring authorization', async () => {
    await expect(service.inspect('npm test && npm run build')).resolves.toMatchObject({
      normalized: 'npm test && npm run build',
      command: 'npm test && npm run build',
      args: [],
      allowed: false,
      executionMode: 'shell',
      shellTokens: ['&&'],
    });
  });

  it('keeps command substitution blocked as a hard syntax error', async () => {
    await expect(service.inspect('npm test $(whoami)')).rejects.toThrow(
      'Command contains forbidden token: $(',
    );
  });

  it('accepts an exact command remembered for a project', async () => {
    projectPermissions.findOne.mockResolvedValue({
      id: 'permission-1',
      command: 'python --version',
    } as ProjectCommandPermission);

    await expect(service.inspect('python --version', 'project-1')).resolves.toMatchObject({
      allowed: true,
      source: 'project',
    });
  });
});
