import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EncryptionService } from '../../common/security/encryption.service';
import { User } from '../users/user.entity';
import { CreateModelConfigDto } from './dto/create-model-config.dto';
import { UpdateModelConfigDto } from './dto/update-model-config.dto';
import { ModelConfig } from './model-config.entity';
import {
  ModelProviderOption,
  ModelProviderPreset,
  MODEL_PROVIDER_PRESETS,
  toProviderOption,
} from './model-provider-presets';

export interface SanitizedModelConfig {
  id: string;
  displayName: string;
  baseUrl: string;
  modelName: string;
  providerId?: string | null;
  supportsTools: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RuntimeModelConfig extends SanitizedModelConfig {
  apiKey: string;
}

export interface ConnectModelConfigInput {
  providerId: string;
  apiKey: string;
  modelName?: string;
  displayName?: string;
  baseUrl?: string;
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
        providerId: null,
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

  searchProviders(query?: string): ModelProviderOption[] {
    const normalizedQuery = query?.trim().toLowerCase();
    if (!normalizedQuery) {
      return MODEL_PROVIDER_PRESETS.map((provider) => toProviderOption(provider));
    }

    return MODEL_PROVIDER_PRESETS.map((provider) => ({
      provider,
      score: this.scoreProvider(provider, normalizedQuery),
    }))
      .filter((match) => match.score !== null)
      .sort(
        (a, b) =>
          (a.score ?? Number.MAX_SAFE_INTEGER) - (b.score ?? Number.MAX_SAFE_INTEGER) ||
          a.provider.displayName.localeCompare(b.provider.displayName),
      )
      .slice(0, 10)
      .map((match) => toProviderOption(match.provider));
  }

  getProvider(providerId: string): ModelProviderOption {
    return toProviderOption(this.findProviderPreset(providerId));
  }

  async connect(owner: User, input: ConnectModelConfigInput): Promise<SanitizedModelConfig> {
    const provider = this.findProviderPreset(input.providerId);
    const baseUrl = this.resolveConnectBaseUrl(provider, input.baseUrl);
    const displayName = this.resolveConnectDisplayName(provider, input.displayName);
    const availableModels = await this.fetchModelIds(baseUrl, input.apiKey);
    const modelName = this.resolveConnectModel(provider, input.modelName, availableModels);

    await this.unsetDefaults(owner.id);
    const config = await this.configs.save(
      this.configs.create({
        owner,
        displayName,
        baseUrl,
        modelName,
        providerId: provider.id,
        encryptedApiKey: this.encryption.encrypt(input.apiKey),
        supportsTools: provider.supportsTools,
        isDefault: true,
      }),
    );
    return this.sanitize(config);
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
    if (dto.apiKey !== undefined && dto.apiKey.trim() !== '') {
      config.encryptedApiKey = this.encryption.encrypt(dto.apiKey);
    }
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
      apiKey: this.decryptApiKey(config),
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
      providerId: config.providerId ?? null,
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

  private decryptApiKey(config: ModelConfig): string {
    try {
      return this.encryption.decrypt(config.encryptedApiKey);
    } catch {
      throw new ConflictException(
        'Model config API key cannot be decrypted with the current master key. Edit this model config and re-enter the API key.',
      );
    }
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

  private findProviderPreset(providerId: string): ModelProviderPreset {
    const provider = MODEL_PROVIDER_PRESETS.find((preset) => preset.id === providerId);
    if (!provider) {
      throw new BadRequestException(`Unknown model provider: ${providerId}`);
    }
    return provider;
  }

  private scoreProvider(provider: ModelProviderPreset, query: string): number | null {
    const id = provider.id.toLowerCase();
    const displayName = provider.displayName.toLowerCase();
    const aliases = provider.aliases.map((alias) => alias.toLowerCase());
    const description = provider.description.toLowerCase();

    if (id.startsWith(query) || displayName.startsWith(query)) return 0;
    if (aliases.some((alias) => alias.startsWith(query))) return 1;
    if (id.includes(query) || displayName.includes(query)) return 2;
    if (aliases.some((alias) => alias.includes(query)) || description.includes(query)) return 3;
    return null;
  }

  private resolveConnectBaseUrl(provider: ModelProviderPreset, baseUrl?: string): string {
    const resolved = provider.requiresCustomBaseUrl ? baseUrl : (baseUrl ?? provider.baseUrl);
    if (!resolved) {
      throw new BadRequestException('Custom provider requires baseUrl.');
    }
    try {
      return new URL(resolved).toString().replace(/\/+$/, '');
    } catch {
      throw new BadRequestException('Provider baseUrl must be a valid URL.');
    }
  }

  private resolveConnectDisplayName(provider: ModelProviderPreset, displayName?: string): string {
    const resolved = provider.requiresCustomBaseUrl ? displayName : (displayName ?? provider.displayName);
    if (!resolved?.trim()) {
      throw new BadRequestException('Custom provider requires displayName.');
    }
    return resolved.trim();
  }

  private resolveConnectModel(
    provider: ModelProviderPreset,
    requestedModel: string | undefined,
    availableModels: string[],
  ): string {
    if (availableModels.length === 0) {
      throw new BadRequestException('Provider returned no models.');
    }

    if (requestedModel) {
      if (!availableModels.includes(requestedModel)) {
        throw new BadRequestException(`Model is not available from this provider: ${requestedModel}`);
      }
      return requestedModel;
    }

    return (
      provider.recommendedModels.find((model) => availableModels.includes(model)) ?? availableModels[0]
    );
  }

  private async fetchModelIds(baseUrl: string, apiKey: string): Promise<string[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new BadRequestException(`Model provider returned HTTP ${response.status}.`);
      }
      const payload = (await response.json()) as { data?: Array<{ id?: unknown }> };
      return (payload.data ?? [])
        .map((model) => model.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        error instanceof Error ? `Provider connection failed: ${error.message}` : 'Provider connection failed.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
