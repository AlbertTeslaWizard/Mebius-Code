import { Repository } from 'typeorm';
import { SessionStatus } from '../../common/enums/session-status.enum';
import { ModelConfigsService } from '../model-configs/model-configs.service';
import { ProjectsService } from '../projects/projects.service';
import { ConversationSummary } from './conversation-summary.entity';
import { Message } from './message.entity';
import { Session } from './session.entity';
import { SessionsService } from './sessions.service';

describe('SessionsService', () => {
  const sessions = {
    findAndCount: jest.fn(),
    findOne: jest.fn(),
  } as unknown as jest.Mocked<Repository<Session>>;
  const messages = {} as jest.Mocked<Repository<Message>>;
  const summaries = {} as jest.Mocked<Repository<ConversationSummary>>;
  const projects = {
    findOwned: jest.fn(),
  } as unknown as jest.Mocked<ProjectsService>;
  const modelConfigs = {
    sanitize: jest.fn((config) => ({
      id: config.id,
      displayName: config.displayName,
      baseUrl: config.baseUrl,
      modelName: config.modelName,
      supportsTools: config.supportsTools,
      isDefault: config.isDefault,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    })),
  } as unknown as jest.Mocked<ModelConfigsService>;
  const events = {};
  const service = new SessionsService(
    sessions,
    messages,
    summaries,
    projects,
    modelConfigs,
    events as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    projects.findOwned.mockResolvedValue({ id: 'project-1' } as never);
    sessions.findAndCount.mockResolvedValue([[sessionFixture()], 1]);
    sessions.findOne.mockResolvedValue(sessionFixture());
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
});

function sessionFixture(): Session {
  const createdAt = new Date('2026-06-01T00:00:00.000Z');
  return {
    id: 'session-1',
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
