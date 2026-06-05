import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../../modules/projects/project.entity';
import { User } from '../../modules/users/user.entity';
import { CommandPolicyConfig } from './command-policy-config.entity';
import { ProjectCommandPermission } from './project-command-permission.entity';

const FORBIDDEN_TOKENS = ['&&', '||', ';', '|', '>', '<', '`', '$(', '\n', '\r'];
const GLOBAL_CONFIG_ID = 'global';

export interface CommandPreset {
  id: string;
  label: string;
  description: string;
  commands: string[];
}

export const COMMAND_PRESETS: CommandPreset[] = [
  {
    id: 'git',
    label: 'Git',
    description: 'Inspect repository state and history without changing files.',
    commands: ['git status', 'git diff', 'git log', 'git branch', 'git show'],
  },
  {
    id: 'node',
    label: 'Node.js',
    description: 'Run common Node.js checks, tests, builds, and linters.',
    commands: [
      'node --version',
      'npm --version',
      'npm test',
      'npm run test',
      'npm run build',
      'npm run lint',
      'npm run typecheck',
    ],
  },
  {
    id: 'python',
    label: 'Python',
    description: 'Inspect Python and run common test or compile checks.',
    commands: [
      'python --version',
      'python -m pytest',
      'python -m compileall',
      'pytest',
      'py --version',
      'py -m pytest',
    ],
  },
];

export interface CommandInspection {
  normalized: string;
  command: string;
  args: string[];
  allowed: boolean;
  source?: 'environment' | 'preset' | 'custom' | 'project';
}

@Injectable()
export class CommandPolicyService {
  private readonly environmentCommands: string[];

  constructor(
    config: ConfigService,
    @InjectRepository(CommandPolicyConfig)
    private readonly configs: Repository<CommandPolicyConfig>,
    @InjectRepository(ProjectCommandPermission)
    private readonly projectPermissions: Repository<ProjectCommandPermission>,
  ) {
    const configured = config.get<string>('MEBIUS_CODE_COMMAND_ALLOWLIST') ?? '';
    this.environmentCommands = this.normalizeCommands(configured.split(','));
  }

  async inspect(command: string, projectId?: string): Promise<CommandInspection> {
    const parsed = this.parseSyntax(command);
    const policy = await this.getConfig();
    const presetCommands = COMMAND_PRESETS.filter((preset) => policy.enabledPresets.includes(preset.id)).flatMap(
      (preset) => preset.commands,
    );
    const globalSources: Array<{ source: CommandInspection['source']; commands: string[] }> = [
      { source: 'environment', commands: this.environmentCommands },
      { source: 'preset', commands: presetCommands },
      { source: 'custom', commands: policy.customCommands },
    ];

    for (const candidate of globalSources) {
      if (candidate.commands.some((item) => this.matchesPrefix(parsed.normalized, item))) {
        return { ...parsed, allowed: true, source: candidate.source };
      }
    }

    if (projectId) {
      const permission = await this.projectPermissions.findOne({
        where: { project: { id: projectId }, command: parsed.normalized },
      });
      if (permission) {
        return { ...parsed, allowed: true, source: 'project' };
      }
    }

    return { ...parsed, allowed: false };
  }

  async parse(command: string, projectId?: string): Promise<{ command: string; args: string[] }> {
    const inspection = await this.inspect(command, projectId);
    if (!inspection.allowed) {
      throw new BadRequestException(
        'Command is not enabled. Ask an administrator to enable a preset or add this command.',
      );
    }
    return { command: inspection.command, args: inspection.args };
  }

  parseAuthorized(command: string): { command: string; args: string[] } {
    const inspection = this.parseSyntax(command);
    return { command: inspection.command, args: inspection.args };
  }

  async listAllowedCommands(projectId?: string): Promise<string[]> {
    const policy = await this.getConfig();
    const projectCommands = projectId
      ? (
          await this.projectPermissions.find({
            where: { project: { id: projectId } },
            order: { createdAt: 'ASC' },
          })
        ).map((item) => item.command)
      : [];
    return this.uniqueCommands([
      ...this.environmentCommands,
      ...COMMAND_PRESETS.filter((preset) => policy.enabledPresets.includes(preset.id)).flatMap(
        (preset) => preset.commands,
      ),
      ...policy.customCommands,
      ...projectCommands,
    ]);
  }

  async describe(canManage: boolean) {
    const policy = await this.getConfig();
    return {
      canManage,
      environmentCommands: this.environmentCommands,
      enabledPresets: policy.enabledPresets,
      customCommands: policy.customCommands,
      effectiveCommands: await this.listAllowedCommands(),
      presets: COMMAND_PRESETS.map((preset) => ({
        ...preset,
        enabled: policy.enabledPresets.includes(preset.id),
      })),
      updatedAt: policy.updatedAt,
    };
  }

  async update(input: { enabledPresets: string[]; customCommands: string[] }): Promise<void> {
    const knownPresetIds = new Set(COMMAND_PRESETS.map((preset) => preset.id));
    const enabledPresets = [...new Set(input.enabledPresets)];
    const unknownPreset = enabledPresets.find((id) => !knownPresetIds.has(id));
    if (unknownPreset) {
      throw new BadRequestException(`Unknown command preset: ${unknownPreset}`);
    }

    const customCommands = this.normalizeCommands(input.customCommands);
    customCommands.forEach((command) => this.parseSyntax(command));
    await this.configs.save(
      this.configs.create({
        id: GLOBAL_CONFIG_ID,
        enabledPresets,
        customCommands,
      }),
    );
  }

  async rememberProjectCommand(project: Project, owner: User, command: string): Promise<void> {
    const parsed = this.parseSyntax(command);
    const existing = await this.projectPermissions.findOne({
      where: { project: { id: project.id }, command: parsed.normalized },
    });
    if (existing) {
      return;
    }
    await this.projectPermissions.save(
      this.projectPermissions.create({
        project,
        createdBy: owner,
        command: parsed.normalized,
      }),
    );
  }

  private async getConfig(): Promise<CommandPolicyConfig> {
    return (
      (await this.configs.findOne({ where: { id: GLOBAL_CONFIG_ID } })) ??
      this.configs.create({
        id: GLOBAL_CONFIG_ID,
        enabledPresets: [],
        customCommands: [],
      })
    );
  }

  private parseSyntax(command: string): Omit<CommandInspection, 'allowed' | 'source'> {
    const normalized = command.trim().replace(/\s+/g, ' ');
    if (!normalized) {
      throw new BadRequestException('Command cannot be empty.');
    }

    const forbidden = FORBIDDEN_TOKENS.find((token) => normalized.includes(token));
    if (forbidden) {
      throw new BadRequestException(`Command contains forbidden token: ${forbidden}`);
    }

    const parts = normalized.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
    const [executable, ...args] = parts.map((part) => part.replace(/^"|"$/g, ''));
    if (!executable) {
      throw new BadRequestException('Command cannot be empty.');
    }
    return { normalized, command: executable, args };
  }

  private matchesPrefix(command: string, rule: string): boolean {
    return command === rule || command.startsWith(`${rule} `);
  }

  private normalizeCommands(commands: string[]): string[] {
    return this.uniqueCommands(commands.map((command) => command.trim().replace(/\s+/g, ' ')).filter(Boolean));
  }

  private uniqueCommands(commands: string[]): string[] {
    return [...new Set(commands)];
  }
}
