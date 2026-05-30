import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const FORBIDDEN_TOKENS = ['&&', '||', ';', '|', '>', '<', '`', '$(', '\n', '\r'];

@Injectable()
export class CommandPolicyService {
  private readonly allowlist: string[];

  constructor(config: ConfigService) {
    const configured = config.get<string>('MEBIUS_CODE_COMMAND_ALLOWLIST') ?? '';
    this.allowlist = configured
      .split(',')
      .map((command) => command.trim())
      .filter(Boolean);
  }

  assertAllowed(command: string): void {
    const normalized = command.trim().replace(/\s+/g, ' ');
    if (!normalized) {
      throw new BadRequestException('Command cannot be empty.');
    }

    const forbidden = FORBIDDEN_TOKENS.find((token) => normalized.includes(token));
    if (forbidden) {
      throw new BadRequestException(`Command contains forbidden token: ${forbidden}`);
    }

    const allowed = this.allowlist.some(
      (item) => normalized === item || normalized.startsWith(`${item} `),
    );

    if (!allowed) {
      throw new BadRequestException('Command is not in the allowlist.');
    }
  }

  parse(command: string): { command: string; args: string[] } {
    this.assertAllowed(command);
    const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
    const [executable, ...args] = parts.map((part) => part.replace(/^"|"$/g, ''));
    if (!executable) {
      throw new BadRequestException('Command cannot be empty.');
    }
    return { command: executable, args };
  }
}

