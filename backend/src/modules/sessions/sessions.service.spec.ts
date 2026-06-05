import { Repository } from 'typeorm';
import { ApprovalStatus, ToolCallStatus } from '../../common/enums/tool-status.enum';
import { SessionStatus } from '../../common/enums/session-status.enum';
import { ModelConfigsService } from '../model-configs/model-configs.service';
import { ProjectsService } from '../projects/projects.service';
import { ToolApproval } from '../tools/tool-approval.entity';
import { ToolCall } from '../tools/tool-call.entity';
import { ConversationSummary } from './conversation-summary.entity';
import { Message } from './message.entity';
import { Session } from './session.entity';
import { SessionsService } from './sessions.service';

describe('SessionsService', () => {
  const sessions = {
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn((session: Session) => Promise.resolve(session)),
    save: jest.fn((session: Session) => Promise.resolve(session)),
  } as unknown as jest.Mocked<Repository<Session>>;
  const messages = {} as jest.Mocked<Repository<Message>>;
  const summaries = {} as jest.Mocked<Repository<ConversationSummary>>;
  const toolCalls = {
    findOne: jest.fn(),
  } as unknown as jest.Mocked<Repository<ToolCall>>;
  const approvals = {
    findOne: jest.fn(),
  } as unknown as jest.Mocked<Repository<ToolApproval>>;
  const projects = {
    findOwned: jest.fn(),
  } as unknown as jest.Mocked<ProjectsService>;
  const modelConfigs = {
    sanitize: jest.fn((config) => ({
      id: config.id,
      displayName: config.displayName,
      baseUrl: config.baseUrl,
      modelName: config.modelName,
      providerId: config.providerId ?? null,
      supportsTools: config.supportsTools,
      isDefault: config.isDefault,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    })),
    findRuntime: jest.fn(() =>
      Promise.resolve({
        id: 'model-2',
        displayName: 'Updated model',
        baseUrl: 'https://api.example.com',
        modelName: 'gpt-updated',
        providerId: null,
        supportsTools: true,
        isDefault: false,
        apiKey: 'sk-test',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ),
    searchProviders: jest.fn(() => [
      {
        id: 'moonshot',
        displayName: 'Moonshot AI',
        description: 'Moonshot Kimi OpenAI-compatible API.',
        aliases: ['kimi'],
        baseUrl: 'https://api.moonshot.cn/v1',
        recommendedModels: ['moonshot-v1-8k'],
        supportsTools: true,
        requiresCustomBaseUrl: false,
      },
    ]),
    getProvider: jest.fn(() => ({
      id: 'moonshot',
      displayName: 'Moonshot AI',
      description: 'Moonshot Kimi OpenAI-compatible API.',
      aliases: ['kimi'],
      baseUrl: 'https://api.moonshot.cn/v1',
      recommendedModels: ['moonshot-v1-8k'],
      supportsTools: true,
      requiresCustomBaseUrl: false,
    })),
    connect: jest.fn(() =>
      Promise.resolve({
        id: 'connected-model',
        providerId: 'moonshot',
        displayName: 'Moonshot AI',
        baseUrl: 'https://api.moonshot.cn/v1',
        modelName: 'moonshot-v1-8k',
        supportsTools: true,
        isDefault: true,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ),
  } as unknown as jest.Mocked<ModelConfigsService>;
  const events = {
    publish: jest.fn(),
  };
  const service = new SessionsService(
    sessions,
    messages,
    summaries,
    toolCalls,
    approvals,
    projects,
    modelConfigs,
    events as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    projects.findOwned.mockResolvedValue({ id: 'project-1' } as never);
    sessions.findAndCount.mockResolvedValue([[sessionFixture()], 1]);
    sessions.findOne.mockResolvedValue(sessionFixture());
    approvals.findOne.mockResolvedValue(null);
    toolCalls.findOne.mockResolvedValue(null);
  });

  it('lists sessions for an owned project with pagination and status filters', async () => {
    const result = await service.listForProject('owner-1', 'project-1', {
      status: SessionStatus.Active,
      limit: 10,
      offset: 20,
    });

    expect(projects.findOwned).toHaveBeenCalledWith('owner-1', 'project-1');
    expect(sessions.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          owner: { id: 'owner-1' },
          project: { id: 'project-1' },
          status: SessionStatus.Active,
        },
        relations: { project: true, activeModelConfig: true },
        order: { updatedAt: 'DESC' },
        take: 10,
        skip: 20,
      }),
    );
    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 'session-1',
        projectId: 'project-1',
        title: 'Feature work',
      }),
    );
  });

  it('returns sanitized session details without encrypted model keys', async () => {
    const result = await service.get('owner-1', 'session-1');

    expect(sessions.findOne).toHaveBeenCalledWith({
      where: { id: 'session-1', owner: { id: 'owner-1' } },
      relations: { owner: true, project: true, activeModelConfig: true },
    });
    expect(result.activeModelConfig).toEqual(
      expect.objectContaining({
        id: 'model-1',
        displayName: 'OpenAI compatible',
      }),
    );
    expect(result.activeModelConfig).not.toHaveProperty('encryptedApiKey');
  });

  it('returns waiting approval activity when the session has a pending approval', async () => {
    approvals.findOne.mockResolvedValue({
      toolCall: {
        name: 'create_patch',
        arguments: { path: 'demo.py', content: 'print(1)' },
      },
    } as unknown as ToolApproval);

    const result = await service.get('owner-1', 'session-1');

    expect(result.agentActivity).toEqual({
      status: 'waiting_for_approval',
      toolName: 'create_patch',
      activity: 'waiting_for_approval',
      targetPaths: ['demo.py'],
    });
    expect(approvals.findOne).toHaveBeenCalledWith({
      where: {
        status: ApprovalStatus.Pending,
        toolCall: { session: { id: 'session-1' }, status: ToolCallStatus.PendingApproval },
      },
      relations: { toolCall: true },
      order: { createdAt: 'DESC' },
    });
  });

  it('returns using tools activity when the session has a running tool call', async () => {
    toolCalls.findOne.mockResolvedValue({
      name: 'run_command',
      arguments: { command: 'npm test' },
    } as unknown as ToolCall);

    const result = await service.get('owner-1', 'session-1');

    expect(result.agentActivity).toEqual({
      status: 'using_tools',
      toolName: 'run_command',
      activity: 'running_tool',
      command: 'npm test',
    });
  });

  it('returns provider search results for /connect queries', async () => {
    const result = await service.handleCommand('owner-1', 'session-1', {
      command: '/connect kimi',
    });

    expect(modelConfigs.searchProviders).toHaveBeenCalledWith('kimi');
    expect(result).toEqual({
      type: 'connect.providers',
      providers: [expect.objectContaining({ id: 'moonshot' })],
    });
  });

  it('returns a provider form before an API key is submitted', async () => {
    const result = await service.handleCommand('owner-1', 'session-1', {
      command: '/connect',
      args: { providerId: 'moonshot' },
    });

    expect(modelConfigs.getProvider).toHaveBeenCalledWith('moonshot');
    expect(result).toEqual(
      expect.objectContaining({
        type: 'connect.form',
        provider: expect.objectContaining({ id: 'moonshot' }),
        fields: expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', type: 'password', required: true }),
        ]),
      }),
    );
  });

  it('connects a provider and switches the active session model', async () => {
    const result = await service.handleCommand('owner-1', 'session-1', {
      command: '/connect',
      args: {
        providerId: 'moonshot',
        apiKey: 'sk-test',
        modelName: 'moonshot-v1-8k',
      },
    });

    expect(modelConfigs.connect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'owner-1' }),
      {
        providerId: 'moonshot',
        apiKey: 'sk-test',
        modelName: 'moonshot-v1-8k',
        displayName: undefined,
        baseUrl: undefined,
      },
    );
    expect(sessions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        activeModelConfig: { id: 'connected-model' },
      }),
    );
    expect(events.publish).toHaveBeenCalledWith('session-1', 'agent_status', {
      status: 'model_connected',
      modelConfigId: 'connected-model',
      providerId: 'moonshot',
      modelName: 'moonshot-v1-8k',
    });
    expect(result).toEqual(
      expect.objectContaining({
        type: 'connect.connected',
        modelConfig: expect.not.objectContaining({ encryptedApiKey: expect.any(String) }),
      }),
    );
  });

  it('switches models with /model and returns a sanitized session view', async () => {
    const result = await service.handleCommand('owner-1', 'session-1', {
      command: '/model model-2',
    });

    expect(modelConfigs.findRuntime).toHaveBeenCalledWith('owner-1', 'model-2');
    expect(sessions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        activeModelConfig: { id: 'model-2' },
      }),
    );
    expect(events.publish).toHaveBeenCalledWith('session-1', 'agent_status', {
      status: 'model_changed',
      modelConfigId: 'model-2',
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'session-1',
        projectId: 'project-1',
        activeModelConfig: expect.objectContaining({
          id: 'model-2',
          displayName: 'Updated model',
        }),
      }),
    );
    expect((result as { activeModelConfig?: unknown }).activeModelConfig).not.toHaveProperty('apiKey');
  });

  it('deletes owned sessions and publishes a deletion event', async () => {
    const result = await service.remove('owner-1', 'session-1');

    expect(sessions.findOne).toHaveBeenCalledWith({
      where: { id: 'session-1', owner: { id: 'owner-1' } },
      relations: { owner: true, project: true, activeModelConfig: true },
    });
    expect(events.publish).toHaveBeenCalledWith('session-1', 'agent_status', {
      status: 'session_deleted',
    });
    expect(sessions.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }));
    expect(result).toEqual({ deleted: true });
  });
});

function sessionFixture(): Session {
  const createdAt = new Date('2026-06-01T00:00:00.000Z');
  return {
    id: 'session-1',
    owner: { id: 'owner-1' },
    project: { id: 'project-1' },
    title: 'Feature work',
    status: SessionStatus.Active,
    activeModelConfig: {
      id: 'model-1',
      displayName: 'OpenAI compatible',
      baseUrl: 'https://api.example.com',
      modelName: 'gpt-test',
      encryptedApiKey: 'ciphertext',
      supportsTools: true,
      isDefault: true,
      createdAt,
      updatedAt: createdAt,
    },
    createdAt,
    updatedAt: createdAt,
  } as Session;
}
