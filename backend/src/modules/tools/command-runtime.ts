export interface CommandRuntimeInfo {
  platform: NodeJS.Platform;
  shellExecutable: string;
  shellSyntax: 'cmd.exe' | 'posix-sh';
  guidance: string;
}

export function resolveCommandRuntime(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): CommandRuntimeInfo {
  if (platform === 'win32') {
    const shellExecutable = env.ComSpec || 'cmd.exe';
    return {
      platform,
      shellExecutable,
      shellSyntax: 'cmd.exe',
      guidance:
        `Command runtime: platform ${platform}; shell commands execute through ${shellExecutable} using cmd.exe syntax. ` +
        'Use Windows cmd-compatible commands, not PowerShell-only commands.',
    };
  }

  return {
    platform,
    shellExecutable: '/bin/sh',
    shellSyntax: 'posix-sh',
    guidance:
      `Command runtime: platform ${platform}; shell commands execute through /bin/sh using POSIX sh syntax. ` +
      'Use POSIX-compatible commands.',
  };
}
