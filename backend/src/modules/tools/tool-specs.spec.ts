import { buildCodingToolSpecs } from './tool-specs';

describe('buildCodingToolSpecs', () => {
  it('includes Windows command runtime guidance in run_command', () => {
    const specs = buildCodingToolSpecs(['npm test'], {
      platform: 'win32',
      shellExecutable: 'C:\\Windows\\System32\\cmd.exe',
      shellSyntax: 'cmd.exe',
      guidance:
        'Command runtime: platform win32; shell commands execute through C:\\Windows\\System32\\cmd.exe using cmd.exe syntax. Use Windows cmd-compatible commands, not PowerShell-only commands.',
    });

    const runCommand = specs.find((tool) => tool.function.name === 'run_command');

    expect(runCommand?.function.description).toContain('Currently enabled command prefixes: npm test');
    expect(runCommand?.function.description).toContain('platform win32');
    expect(runCommand?.function.description).toContain('cmd.exe syntax');
  });

  it('includes POSIX command runtime guidance in run_command', () => {
    const specs = buildCodingToolSpecs([], {
      platform: 'linux',
      shellExecutable: '/bin/sh',
      shellSyntax: 'posix-sh',
      guidance:
        'Command runtime: platform linux; shell commands execute through /bin/sh using POSIX sh syntax. Use POSIX-compatible commands.',
    });

    const runCommand = specs.find((tool) => tool.function.name === 'run_command');

    expect(runCommand?.function.description).toContain('No command prefixes are currently enabled');
    expect(runCommand?.function.description).toContain('platform linux');
    expect(runCommand?.function.description).toContain('/bin/sh');
    expect(runCommand?.function.description).toContain('POSIX sh syntax');
  });
});
