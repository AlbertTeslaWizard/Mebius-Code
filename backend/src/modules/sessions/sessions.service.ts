import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { MessageRole } from '../../common/enums/message-role.enum';
import { SessionStatus } from '../../common/enums/session-status.enum';
import { EventsService } from '../events/events.service';
import { ModelConfigsService, SanitizedModelConfig } from '../model-configs/model-configs.service';
import { ProjectsService } from '../projects/projects.service';
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
    return this.toView(await this.findOwned(ownerId, sessionId));
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
      await this.modelConfigs.findRuntime(ownerId, modelConfigId);
      session.activeModelConfig = { id: modelConfigId } as Session['activeModelConfig'];
      const saved = await this.sessions.save(session);
      this.events.publish(session.id, 'agent_status', {
        status: 'model_changed',
        modelConfigId,
      });
      return saved;
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

  private toView(session: Session): SessionView {
    return {
      id: session.id,
      projectId: session.project.id,
      title: session.title,
      status: session.status,
      activeModelConfig: session.activeModelConfig
        ? this.modelConfigs.sanitize(session.activeModelConfig)
        : null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}
