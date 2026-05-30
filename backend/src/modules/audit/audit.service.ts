import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { AuditLog } from './audit-log.entity';

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
}

