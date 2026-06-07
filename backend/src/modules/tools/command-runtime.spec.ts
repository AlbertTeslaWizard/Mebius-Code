import { resolveCommandRuntime } from './command-runtime';

describe('resolveCommandRuntime', () => {
  it('describes Windows command execution with cmd.exe syntax', () => {
    const runtime = resolveCommandRuntime('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' });

    expect(runtime).toMatchObject({
      platform: 'win32',
      shellExecutable: 'C:\\Windows\\System32\\cmd.exe',
      shellSyntax: 'cmd.exe',
    });
    expect(runtime.guidance).toContain('cmd.exe syntax');
    expect(runtime.guidance).toContain('not PowerShell-only commands');
  });

  it('describes Linux command execution with POSIX sh syntax', () => {
    const runtime = resolveCommandRuntime('linux', {});

    expect(runtime).toMatchObject({
      platform: 'linux',
      shellExecutable: '/bin/sh',
      shellSyntax: 'posix-sh',
    });
    expect(runtime.guidance).toContain('POSIX sh syntax');
  });

  it('describes macOS command execution with POSIX sh syntax', () => {
    const runtime = resolveCommandRuntime('darwin', {});

    expect(runtime).toMatchObject({
      platform: 'darwin',
      shellExecutable: '/bin/sh',
      shellSyntax: 'posix-sh',
    });
    expect(runtime.guidance).toContain('POSIX sh syntax');
  });
});
