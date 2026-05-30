import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandPolicyService } from './command-policy.service';

describe('CommandPolicyService', () => {
  const service = new CommandPolicyService({
    get: (key: string) =>
      key === 'MEBIUS_CODE_COMMAND_ALLOWLIST' ? 'git status,npm test,npm run build' : undefined,
  } as ConfigService);

  it('accepts allowlisted commands', () => {
    expect(service.parse('npm run build')).toEqual({
      command: 'npm',
      args: ['run', 'build'],
    });
  });

  it('rejects commands outside the allowlist', () => {
    expect(() => service.assertAllowed('rm -rf .')).toThrow(BadRequestException);
  });

  it('rejects command chaining tokens', () => {
    expect(() => service.assertAllowed('npm test && rm -rf .')).toThrow(BadRequestException);
  });
});

