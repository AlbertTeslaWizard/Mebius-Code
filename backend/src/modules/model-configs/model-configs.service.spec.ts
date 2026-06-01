import { BadRequestException } from '@nestjs/common';
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
      json: () =>
        Promise.resolve({
          data: [{ id: 'qwen-plus' }, { id: 'qwen-turbo' }],
        }),
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
});
