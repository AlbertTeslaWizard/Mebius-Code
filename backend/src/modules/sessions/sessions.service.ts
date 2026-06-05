import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { MessageRole } from '../../common/enums/message-role.enum';
import { SessionStatus } from '../../common/enums/session-status.enum';
import { ApprovalStatus, ToolCallStatus } from '../../common/enums/tool-status.enum';
import { EventsService } from '../events/events.service';
import { ModelConfigsService, SanitizedModelConfig } from '../model-configs/model-configs.service';
import { ProjectsService } from '../projects/projects.service';
import { ToolApproval } from '../tools/tool-approval.entity';
import { ToolCall } from '../tools/tool-call.entity';
import { User } from '../users/user.entity';
import { ConversationSummary } from './conversation-summary.entity';
import { CreateMessageDto } from './dto/create-message.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { ListSessionsDto } from './dto/list-sessions.dto';
import { SlashCommandDto } from './dto/slash-command.dto';
import { Message } from './message.entity';
import { Session } from './session.entity';

export interface SessionView {
  id: string;
  projectId: string;
  title: string;
  status: SessionStatus;
  activeModelConfig: SanitizedModelConfig | null;
  agentActivity?: {
    status: 'using_tools' | 'waiting_for_approval';
    toolName?: string;
    activity?: string;
    targetPaths?: string[];
    command?: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionList {
  items: SessionView[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session)
    private readonly sessions: Repository<Session>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectRepository(ConversationSummary)
    private readonly summaries: Repository<ConversationSummary>,
    @InjectRepository(ToolCall)
    private readonly toolCalls: Repository<ToolCall>,
    @InjectRepository(ToolApproval)
    private readonly approvals: Repository<ToolApproval>,
    private readonly projects: ProjectsService,
    private readonly modelConfigs: ModelConfigsService,
    private readonly events: EventsService,
  ) {}

  async create(projectId: string, owner: User, dto: CreateSessionDto): Promise<Session> {
    const project = await this.projects.findOwned(owner.id, projectId);
    const activeModelConfig = dto.modelConfigId
      ? ({ id: dto.modelConfigId } as unknown as Session['activeModelConfig'])
      : null;

    const session = await this.sessions.save(
      this.sessions.create({
        owner,
        project,
        activeModelConfig,
        title: dto.title ?? `Session for ${project.name}`,
        status: SessionStatus.Active,
      }),
    );
    this.events.publish(session.id, 'agent_status', { status: 'session_created' });
    return session;
  }

  async findOwned(ownerId: string, sessionId: string): Promise<Session> {
    const session = await this.sessions.findOne({
      where: { id: sessionId, owner: { id: ownerId } },
      relations: { owner: true, project: true, activeModelConfig: true },
    });
    if (!session) {
      throw new NotFoundException('Session not found.');
    }
    return session;
  }

  async get(ownerId: string, sessionId: string): Promise<SessionView> {
    const session = await this.findOwned(ownerId, sessionId);
    const agentActivity = await this.getAgentActivity(session.id);
    return this.toView(session, agentActivity);
  }

  async listForProject(
    ownerId: string,
    projectId: string,
    query: ListSessionsDto,
  ): Promise<SessionList> {
    await this.projects.findOwned(ownerId, projectId);
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const where: FindOptionsWhere<Session> = {
      owner: { id: ownerId },
      project: { id: projectId },
    };

    if (query.status) {
      where.status = query.status;
    }

    const [items, total] = await this.sessions.findAndCount({
      where,
      relations: { project: true, activeModelConfig: true },
      order: { updatedAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return {
      items: items.map((session) => this.toView(session)),
      total,
      limit,
      offset,
    };
  }

  async listMessages(ownerId: string, sessionId: string): Promise<Message[]> {
    const session = await this.findOwned(ownerId, sessionId);
    return this.messages.find({
      where: { session: { id: session.id } },
      order: { createdAt: 'ASC' },
    });
  }

  async addUserMessage(ownerId: string, sessionId: string, dto: CreateMessageDto): Promise<Message> {
    const session = await this.findOwned(ownerId, sessionId);
    const message = await this.addMessage(session, MessageRole.User, dto.content, dto.metadata);
    this.events.publish(session.id, 'message_created', {
      id: message.id,
      role: message.role,
      content: message.content,
    });
    return message;
  }

  async remove(ownerId: string, sessionId: string): Promise<{ deleted: true }> {
    const session = await this.findOwned(ownerId, sessionId);
    this.events.publish(session.id, 'agent_status', { status: 'session_deleted' });
    await this.sessions.remove(session);
    return { deleted: true };
  }

  async addMessage(
    session: Session,
    role: MessageRole,
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<Message> {
    return this.messages.save(
      this.messages.create({
        session,
        role,
        content,
        metadata,
      }),
    );
  }

  async latestSummary(sessionId: string): Promise<ConversationSummary | null> {
    return this.summaries.findOne({
      where: { session: { id: sessionId } },
      order: { createdAt: 'DESC' },
    });
  }

  async findPendingApprovalTool(sessionId: string): Promise<ToolApproval | null> {
    return this.approvals.findOne({
      where: {
        status: ApprovalStatus.Pending,
        toolCall: { session: { id: sessionId }, status: ToolCallStatus.PendingApproval },
      },
      relations: { toolCall: true },
      order: { createdAt: 'DESC' },
    });
  }

  async handleCommand(ownerId: string, sessionId: string, dto: SlashCommandDto): Promise<unknown> {
    const session = await this.findOwned(ownerId, sessionId);
    const [name, ...parts] = dto.command.trim().split(/\s+/);

    if (name === '/clear') {
      await this.messages
        .createQueryBuilder()
        .delete()
        .from(Message)
        .where('session_id = :sessionId', { sessionId: session.id })
        .execute();
      this.events.publish(session.id, 'agent_status', { status: 'context_cleared' });
      return { cleared: true };
    }

    if (name === '/compact') {
      return this.compact(session);
    }

    if (name === '/model') {
      const modelConfigId =
        typeof dto.args?.modelConfigId === 'string' ? dto.args.modelConfigId : parts[0];
      if (!modelConfigId) {
        throw new BadRequestException('/model requires a model config id.');
      }
      const modelConfig = await this.modelConfigs.findRuntime(ownerId, modelConfigId);
      session.activeModelConfig = { id: modelConfigId } as Session['activeModelConfig'];
      const saved = await this.sessions.save(session);
      this.events.publish(session.id, 'agent_status', {
        status: 'model_changed',
        modelConfigId,
      });
      return this.toView({ ...saved, activeModelConfig: modelConfig } as unknown as Session);
    }

    if (name === '/connect') {
      return this.connectModel(session, parts.join(' '), dto.args);
    }

    throw new BadRequestException(`Unsupported slash command: ${name}`);
  }

  async compact(session: Session): Promise<ConversationSummary> {
    const messages = await this.messages.find({
      where: { session: { id: session.id } },
      order: { createdAt: 'ASC' },
      take: 100,
    });
    const content = messages
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n')
      .slice(0, 4000);
    const summary = await this.summaries.save(
      this.summaries.create({
        session,
        content: content ? `Conversation compacted summary:\n${content}` : 'Empty conversation.',
        tokenEstimate: Math.ceil(content.length / 4),
      }),
    );
    await this.messages
      .createQueryBuilder()
      .delete()
      .from(Message)
      .where('session_id = :sessionId', { sessionId: session.id })
      .execute();
    this.events.publish(session.id, 'agent_status', {
      status: 'context_compacted',
      summaryId: summary.id,
    });
    return summary;
  }

  private toView(
    session: Session,
    agentActivity: SessionView['agentActivity'] = null,
  ): SessionView {
    return {
      id: session.id,
      projectId: session.project.id,
      title: session.title,
      status: session.status,
      activeModelConfig: session.activeModelConfig
        ? this.modelConfigs.sanitize(session.activeModelConfig)
        : null,
      agentActivity,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  private async getAgentActivity(sessionId: string): Promise<SessionView['agentActivity']> {
    const pendingApproval = await this.findPendingApprovalTool(sessionId);
    if (pendingApproval?.toolCall) {
      return this.buildAgentActivity(pendingApproval.toolCall, 'waiting_for_approval');
    }

    const runningTool = await this.toolCalls.findOne({
      where: {
        session: { id: sessionId },
        status: ToolCallStatus.Running,
      },
      order: { updatedAt: 'DESC' },
    });
    if (runningTool) {
      return this.buildAgentActivity(runningTool, 'using_tools');
    }

    return null;
  }

  private buildAgentActivity(
    toolCall: ToolCall,
    status: NonNullable<SessionView['agentActivity']>['status'],
  ): NonNullable<SessionView['agentActivity']> {
    const args = toolCall.arguments ?? {};
    const activity: NonNullable<SessionView['agentActivity']> = {
      status,
      toolName: toolCall.name,
      activity:
        toolCall.name === 'create_patch'
          ? status === 'waiting_for_approval'
            ? 'waiting_for_approval'
            : 'applying_patch'
          : 'running_tool',
    };
    const targetPaths = this.extractToolTargetPaths(toolCall.name, args);
    if (targetPaths.length > 0) {
      activity.targetPaths = targetPaths;
    }
    if (toolCall.name === 'run_command' && typeof args.command === 'string') {
      activity.command = args.command;
    }
    return activity;
  }

  private extractToolTargetPaths(toolName: string, args: Record<string, unknown>): string[] {
    if (toolName !== 'create_patch') {
      return [];
    }

    const rawPaths = Array.isArray(args.files)
      ? args.files.map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>).path : undefined))
      : [args.path];
    return rawPaths
      .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      .map((path) => path.trim().replaceAll('\\', '/'));
  }

  private async connectModel(
    session: Session,
    commandQuery: string,
    args: Record<string, unknown> | undefined,
  ): Promise<unknown> {
    const providerId = typeof args?.providerId === 'string' ? args.providerId : undefined;
    if (!providerId) {
      const query = typeof args?.query === 'string' ? args.query : commandQuery;
      return {
        type: 'connect.providers',
        providers: this.modelConfigs.searchProviders(query),
      };
    }

    const provider = this.modelConfigs.getProvider(providerId);
    const apiKey = typeof args?.apiKey === 'string' ? args.apiKey : undefined;
    if (!apiKey) {
      return {
        type: 'connect.form',
        provider,
        fields: this.connectFields(provider.id),
      };
    }

    const modelConfig = await this.modelConfigs.connect(session.owner as User, {
      providerId,
      apiKey,
      modelName: typeof args?.modelName === 'string' ? args.modelName : undefined,
      displayName: typeof args?.displayName === 'string' ? args.displayName : undefined,
      baseUrl: typeof args?.baseUrl === 'string' ? args.baseUrl : undefined,
    });
    session.activeModelConfig = { id: modelConfig.id } as Session['activeModelConfig'];
    const saved = await this.sessions.save(session);
    this.events.publish(session.id, 'agent_status', {
      status: 'model_connected',
      modelConfigId: modelConfig.id,
      providerId: modelConfig.providerId,
      modelName: modelConfig.modelName,
    });
    return {
      type: 'connect.connected',
      modelConfig,
      session: this.toView({ ...saved, activeModelConfig: modelConfig } as Session),
    };
  }

  private connectFields(providerId: string): Array<{
    name: string;
    label: string;
    type: 'text' | 'password';
    required: boolean;
  }> {
    const baseFields: Array<{
      name: string;
      label: string;
      type: 'text' | 'password';
      required: boolean;
    }> = [{ name: 'apiKey', label: 'API Key', type: 'password', required: true }];

    if (providerId === 'custom') {
      return [
        { name: 'displayName', label: 'Display Name', type: 'text', required: true },
        { name: 'baseUrl', label: 'Base URL', type: 'text', required: true },
        { name: 'modelName', label: 'Model Name', type: 'text', required: false },
        ...baseFields,
      ];
    }

    return [
      { name: 'modelName', label: 'Model Name', type: 'text', required: false },
      ...baseFields,
    ];
  }
}
