import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EncryptionService } from '../../common/security/encryption.service';
import { User } from '../users/user.entity';
import { CreateModelConfigDto } from './dto/create-model-config.dto';
import { UpdateModelConfigDto } from './dto/update-model-config.dto';
import { ModelConfig } from './model-config.entity';

export interface SanitizedModelConfig {
  id: string;
  displayName: string;
  baseUrl: string;
  modelName: string;
  supportsTools: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RuntimeModelConfig extends SanitizedModelConfig {
  apiKey: string;
}

@Injectable()
export class ModelConfigsService {
  constructor(
    @InjectRepository(ModelConfig)
    private readonly configs: Repository<ModelConfig>,
    private readonly encryption: EncryptionService,
  ) {}

  async create(owner: User, dto: CreateModelConfigDto): Promise<SanitizedModelConfig> {
    if (dto.isDefault) {
      await this.unsetDefaults(owner.id);
    }

    const config = await this.configs.save(
      this.configs.create({
        owner,
        displayName: dto.displayName,
        baseUrl: dto.baseUrl.replace(/\/+$/, ''),
        modelName: dto.modelName,
        encryptedApiKey: this.encryption.encrypt(dto.apiKey),
        supportsTools: dto.supportsTools ?? true,
        isDefault: dto.isDefault ?? false,
      }),
    );
    return this.sanitize(config);
  }

  async list(ownerId: string): Promise<SanitizedModelConfig[]> {
    const configs = await this.configs.find({
      where: { owner: { id: ownerId } },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
    return configs.map((config) => this.sanitize(config));
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateModelConfigDto,
  ): Promise<SanitizedModelConfig> {
    const config = await this.findOwned(ownerId, id);
    if (dto.isDefault) {
      await this.unsetDefaults(ownerId);
    }

    if (dto.displayName !== undefined) config.displayName = dto.displayName;
    if (dto.baseUrl !== undefined) config.baseUrl = dto.baseUrl.replace(/\/+$/, '');
    if (dto.modelName !== undefined) config.modelName = dto.modelName;
    if (dto.apiKey !== undefined) config.encryptedApiKey = this.encryption.encrypt(dto.apiKey);
    if (dto.supportsTools !== undefined) config.supportsTools = dto.supportsTools;
    if (dto.isDefault !== undefined) config.isDefault = dto.isDefault;

    return this.sanitize(await this.configs.save(config));
  }

  async remove(ownerId: string, id: string): Promise<{ deleted: true }> {
    const config = await this.findOwned(ownerId, id);
    await this.configs.remove(config);
    return { deleted: true };
  }

  async findRuntime(ownerId: string, id?: string): Promise<RuntimeModelConfig> {
    const config = id ? await this.findOwned(ownerId, id) : await this.findDefault(ownerId);
    return {
      ...this.sanitize(config),
      apiKey: this.encryption.decrypt(config.encryptedApiKey),
    };
  }

  async test(ownerId: string, id: string): Promise<{ ok: boolean; status?: number; message: string }> {
    const config = await this.findRuntime(ownerId, id);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${config.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
        signal: controller.signal,
      });
      return {
        ok: response.ok,
        status: response.status,
        message: response.ok ? 'Model provider is reachable.' : 'Provider returned an error.',
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Connection test failed.',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  sanitize(config: ModelConfig): SanitizedModelConfig {
    return {
      id: config.id,
      displayName: config.displayName,
      baseUrl: config.baseUrl,
      modelName: config.modelName,
      supportsTools: config.supportsTools,
      isDefault: config.isDefault,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }

  private async findOwned(ownerId: string, id: string): Promise<ModelConfig> {
    const config = await this.configs.findOne({ where: { id, owner: { id: ownerId } } });
    if (!config) {
      throw new NotFoundException('Model config not found.');
    }
    return config;
  }

  private async findDefault(ownerId: string): Promise<ModelConfig> {
    const config =
      (await this.configs.findOne({
        where: { owner: { id: ownerId }, isDefault: true },
      })) ??
      (await this.configs.findOne({
        where: { owner: { id: ownerId } },
        order: { createdAt: 'DESC' },
      }));

    if (!config) {
      throw new NotFoundException('No model config is available.');
    }
    return config;
  }

  private async unsetDefaults(ownerId: string): Promise<void> {
    await this.configs
      .createQueryBuilder()
      .update(ModelConfig)
      .set({ isDefault: false })
      .where('owner_id = :ownerId', { ownerId })
      .execute();
  }
}

