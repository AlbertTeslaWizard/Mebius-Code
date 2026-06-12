import { PermissionMode } from '../../common/enums/permission-mode.enum';
import type { CommandInspection } from '../../common/security/command-policy.service';
import {
  commandApprovalPattern,
  decidePermission,
  matchesSessionApprovalRule,
} from './permission-decision';

describe('permission decision', () => {
  it('allows read tools in every mode', () => {
    for (const mode of Object.values(PermissionMode)) {
      expect(decidePermission(mode, { name: 'read_file', args: { path: 'README.md' } })).toBe(
        'allow',
      );
      expect(
        decidePermission(mode, { name: 'web_search', args: { query: 'nestjs latest release' } }),
      ).toBe('allow');
    }
  });

  it('asks before writes in ask_first and allows workspace writes in auto', () => {
    const request = { name: 'create_patch', args: { path: 'src/app.ts', content: 'export {}' } };

    expect(decidePermission(PermissionMode.AskFirst, request)).toBe('ask');
    expect(decidePermission(PermissionMode.Auto, request)).toBe('allow');
  });

  it('asks for external paths instead of auto-allowing them', () => {
    const request = { name: 'create_patch', args: { path: '../outside.ts', content: 'export {}' } };

    expect(decidePermission(PermissionMode.ReadOnly, request)).toBe('deny');
    expect(decidePermission(PermissionMode.Auto, request)).toBe('ask');
  });

  it('allows safe commands in auto and asks for risky commands', () => {
    expect(decidePermission(PermissionMode.Auto, commandRequest('npm test'))).toBe('allow');
    expect(decidePermission(PermissionMode.Auto, commandRequest('npm install'))).toBe('ask');
    expect(decidePermission(PermissionMode.Auto, commandRequest('git reset --hard'))).toBe('ask');
  });

  it('keeps read_only strict for network commands', () => {
    expect(
      decidePermission(PermissionMode.ReadOnly, commandRequest('curl https://example.com')),
    ).toBe('deny');
  });

  it('allows read-only MCP tools and gates mutating MCP tools by permission mode', () => {
    const readOnlyRequest = { name: 'mcp__context7__query-docs', args: {}, readOnly: true };
    const mutatingRequest = { name: 'mcp__github__create_issue', args: {}, readOnly: false };

    for (const mode of Object.values(PermissionMode)) {
      expect(decidePermission(mode, readOnlyRequest)).toBe('allow');
    }
    expect(decidePermission(PermissionMode.ReadOnly, mutatingRequest)).toBe('deny');
    expect(decidePermission(PermissionMode.AskFirst, mutatingRequest)).toBe('ask');
    expect(decidePermission(PermissionMode.Auto, mutatingRequest)).toBe('ask');
    expect(decidePermission(PermissionMode.FullAccess, mutatingRequest)).toBe('allow');
  });

  it('uses session approval rules before mode defaults while keeping external command paths guarded', () => {
    const pattern = commandApprovalPattern('npm test -- --runInBand');
    const rule = { toolKind: 'run_command', pattern, scope: 'workspace' };

    expect(matchesSessionApprovalRule(commandRequest('npm test -- --watch'), [rule])).toBe(true);
    expect(
      decidePermission(PermissionMode.AskFirst, commandRequest('npm test -- --watch'), [rule]),
    ).toBe('allow');
    expect(matchesSessionApprovalRule(commandRequest('npm test C:/outside'), [rule])).toBe(false);
  });
});

function commandRequest(command: string) {
  return {
    name: 'run_command',
    args: { command },
    commandInspection: inspectCommand(command),
  };
}

function inspectCommand(command: string): CommandInspection {
  const normalized = command.trim().replace(/\s+/g, ' ');
  const shellTokens = ['&&', '||', ';', '|', '>', '<'].filter((token) =>
    normalized.includes(token),
  );
  const parts =
    normalized.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? [];
  const [executable, ...args] = parts;
  return {
    normalized,
    command: shellTokens.length > 0 ? normalized : executable,
    args: shellTokens.length > 0 ? [] : args,
    allowed: false,
    executionMode: shellTokens.length > 0 ? 'shell' : 'argv',
    shellTokens,
  };
}
