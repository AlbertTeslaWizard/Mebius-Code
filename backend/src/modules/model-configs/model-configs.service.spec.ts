import { BadRequestException, ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { EncryptionService } from '../../common/security/encryption.service';
import { User } from '../users/user.entity';
import { ModelConfig } from './model-config.entity';
import { ModelConfigsService } from './model-configs.service';

describe('ModelConfigsService', () => {
  const createdAt = new Date('2026-06-01T00:00:00.000Z');
  const queryBuilder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  const configs = {
    create: jest.fn((input: Partial<ModelConfig>) => input),
    find: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn((input: ModelConfig) => Promise.resolve(input)),
    save: jest.fn((input: Partial<ModelConfig>) =>
      Promise.resolve({
        id: 'config-1',
        createdAt,
        updatedAt: createdAt,
        ...input,
      } as ModelConfig),
    ),
    createQueryBuilder: jest.fn(() => queryBuilder),
  } as unknown as jest.Mocked<Repository<ModelConfig>>;
  const encryption = {
    encrypt: jest.fn((value: string) => `encrypted:${value}`),
    decrypt: jest.fn(),
  } as unknown as jest.Mocked<EncryptionService>;
  const service = new ModelConfigsService(configs, encryption);
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            data: [{ id: 'qwen-plus' }, { id: 'qwen-turbo' }],
          }),
        ),
    }) as jest.Mock;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('searches providers by English and Chinese aliases', () => {
    expect(service.searchProviders('kimi')[0].id).toBe('moonshot');
    expect(service.searchProviders('通义')[0].id).toBe('dashscope');
  });

  it('connects a provider after validating available models', async () => {
    const result = await service.connect({ id: 'owner-1' } as User, {
      providerId: 'dashscope',
      apiKey: 'sk-test',
    });

    expect(global.fetch).toHaveBeenCalledWith('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
      headers: { Authorization: 'Bearer sk-test' },
      signal: expect.any(AbortSignal),
    });
    expect(queryBuilder.where).toHaveBeenCalledWith('owner_id = :ownerId', { ownerId: 'owner-1' });
    expect(configs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'dashscope',
        encryptedApiKey: 'encrypted:sk-test',
        modelName: 'qwen-plus',
        isDefault: true,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'config-1',
        providerId: 'dashscope',
        modelName: 'qwen-plus',
      }),
    );
    expect(result).not.toHaveProperty('encryptedApiKey');
  });

  it('lists DeepSeek model choices with configured and reusable-key state', async () => {
    configs.find.mockResolvedValue([
      configFixture({
        id: 'deepseek-config',
        baseUrl: 'https://api.deepseek.com',
        modelName: 'deepseek-v4-flash',
        providerId: null,
        isDefault: true,
      }),
    ]);

    const result = await service.listModelChoices('owner-1', null);

    expect(result).toEqual([
      expect.objectContaining({
        modelName: 'deepseek-v4-flash',
        configured: true,
        active: true,
        isDefault: true,
        requiresApiKey: false,
        modelConfigId: 'deepseek-config',
      }),
      expect.objectContaining({
        modelName: 'deepseek-v4-pro',
        configured: false,
        active: false,
        requiresApiKey: false,
      }),
    ]);
  });

  it('selects an existing model config and makes it default', async () => {
    configs.find.mockResolvedValue([
      configFixture({
        id: 'deepseek-config',
        baseUrl: 'https://api.deepseek.com',
        modelName: 'deepseek-v4-flash',
        providerId: null,
        isDefault: false,
      }),
    ]);

    const result = await service.selectModel({ id: 'owner-1' } as User, {
      providerId: 'deepseek',
      modelName: 'deepseek-v4-flash',
    });

    expect(queryBuilder.where).toHaveBeenCalledWith('owner_id = :ownerId', { ownerId: 'owner-1' });
    expect(configs.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'deepseek-config', isDefault: true }));
    expect(result).toEqual(expect.objectContaining({ id: 'deepseek-config', modelName: 'deepseek-v4-flash' }));
    expect(result).not.toHaveProperty('encryptedApiKey');
  });

  it('creates a new DeepSeek model config by reusing an existing provider key', async () => {
    configs.find.mockResolvedValue([
      configFixture({
        id: 'deepseek-config',
        baseUrl: 'https://api.deepseek.com',
        modelName: 'deepseek-v4-flash',
        providerId: null,
        encryptedApiKey: 'encrypted:reusable-key',
      }),
    ]);

    const result = await service.selectModel({ id: 'owner-1' } as User, {
      providerId: 'deepseek',
      modelName: 'deepseek-v4-pro',
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(configs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'deepseek',
        modelName: 'deepseek-v4-pro',
        encryptedApiKey: 'encrypted:reusable-key',
        isDefault: true,
      }),
    );
    expect(result).toEqual(expect.objectContaining({ modelName: 'deepseek-v4-pro', isDefault: true }));
  });

  it('requires an API key before creating an unconfigured DeepSeek model', async () => {
    configs.find.mockResolvedValue([]);

    await expect(
      service.selectModel({ id: 'owner-1' } as User, {
        providerId: 'deepseek',
        modelName: 'deepseek-v4-pro',
      }),
    ).rejects.toThrow('API key is required for this model.');

    expect(configs.save).not.toHaveBeenCalled();
  });

  it('validates a submitted API key before creating a DeepSeek model config', async () => {
    configs.find.mockResolvedValue([]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            data: [{ id: 'deepseek-v4-pro' }],
          }),
        ),
    }) as jest.Mock;

    await service.selectModel({ id: 'owner-1' } as User, {
      providerId: 'deepseek',
      modelName: 'deepseek-v4-pro',
      apiKey: 'sk-deepseek',
    });

    expect(global.fetch).toHaveBeenCalledWith('https://api.deepseek.com/models', {
      headers: { Authorization: 'Bearer sk-deepseek' },
      signal: expect.any(AbortSignal),
    });
    expect(configs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'deepseek-v4-pro',
        encryptedApiKey: 'encrypted:sk-deepseek',
        isDefault: true,
      }),
    );
  });

  it('rejects unavailable requested models without saving', async () => {
    await expect(
      service.connect({ id: 'owner-1' } as User, {
        providerId: 'dashscope',
        apiKey: 'sk-test',
        modelName: 'missing-model',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(configs.save).not.toHaveBeenCalled();
  });

  it('rejects failed provider validation without saving', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
    }) as jest.Mock;

    await expect(
      service.connect({ id: 'owner-1' } as User, {
        providerId: 'dashscope',
        apiKey: 'bad-key',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(configs.save).not.toHaveBeenCalled();
  });

  it('rejects an empty provider models response without saving', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    }) as jest.Mock;

    await expect(
      service.connect({ id: 'owner-1' } as User, {
        providerId: 'dashscope',
        apiKey: 'sk-test',
      }),
    ).rejects.toThrow('Model provider returned an empty response.');

    expect(configs.save).not.toHaveBeenCalled();
  });

  it('rejects an invalid provider models JSON response without saving', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('not json'),
    }) as jest.Mock;

    await expect(
      service.connect({ id: 'owner-1' } as User, {
        providerId: 'dashscope',
        apiKey: 'sk-test',
      }),
    ).rejects.toThrow('Model provider returned invalid JSON. not json');

    expect(configs.save).not.toHaveBeenCalled();
  });

  it('keeps the existing API key when update receives a blank API key', async () => {
    configs.findOne.mockResolvedValue(configFixture());

    const result = await service.update('owner-1', 'config-1', {
      displayName: 'Updated config',
      apiKey: '',
    });

    expect(configs.findOne).toHaveBeenCalledWith({
      where: { id: 'config-1', owner: { id: 'owner-1' } },
    });
    expect(encryption.encrypt).not.toHaveBeenCalled();
    expect(configs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'Updated config',
        encryptedApiKey: 'encrypted:old-key',
      }),
    );
    expect(result).toEqual(expect.objectContaining({ displayName: 'Updated config' }));
    expect(result).not.toHaveProperty('encryptedApiKey');
  });

  it('deletes owned model configs without exposing credentials', async () => {
    const config = configFixture();
    configs.findOne.mockResolvedValue(config);

    const result = await service.remove('owner-1', 'config-1');

    expect(configs.remove).toHaveBeenCalledWith(config);
    expect(result).toEqual({ deleted: true });
  });

  it('returns a clear conflict when an existing API key cannot be decrypted with the current master key', async () => {
    configs.findOne.mockResolvedValue(configFixture());
    encryption.decrypt.mockImplementation(() => {
      throw new Error('Unsupported state or unable to authenticate data');
    });

    await expect(service.findRuntime('owner-1', 'config-1')).rejects.toThrow(ConflictException);
    await expect(service.findRuntime('owner-1', 'config-1')).rejects.toThrow(
      'Model config API key cannot be decrypted with the current master key',
    );
  });
});

function configFixture(overrides: Partial<ModelConfig> = {}): ModelConfig {
  const createdAt = new Date('2026-06-01T00:00:00.000Z');
  return {
    id: 'config-1',
    owner: { id: 'owner-1' },
    displayName: 'Existing config',
    baseUrl: 'https://api.example.com',
    modelName: 'gpt-test',
    providerId: null,
    encryptedApiKey: 'encrypted:old-key',
    supportsTools: true,
    isDefault: true,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  } as ModelConfig;
}
