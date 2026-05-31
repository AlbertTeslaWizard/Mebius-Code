import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { User } from '../users/user.entity';
import { AuditLog } from './audit-log.entity';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';

export interface AuditLogList {
  items: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly logs: Repository<AuditLog>,
  ) {}

  record(input: {
    actor?: User | null;
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLog> {
    return this.logs.save(
      this.logs.create({
        actor: input.actor ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: input.metadata ?? {},
      }),
    );
  }

  async list(viewer: AuthenticatedUser, query: ListAuditLogsDto): Promise<AuditLogList> {
    const where: FindOptionsWhere<AuditLog> = {};
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    if (query.action) {
      where.action = query.action;
    }
    if (query.resourceType) {
      where.resourceType = query.resourceType;
    }
    if (query.resourceId) {
      where.resourceId = query.resourceId;
    }

    const actorId = viewer.role === UserRole.Admin ? query.actorId : viewer.sub;
    if (actorId) {
      where.actor = { id: actorId };
    }

    const [items, total] = await this.logs.findAndCount({
      where,
      relations: { actor: true },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total, limit, offset };
  }
}
