import { Repository } from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AuditLog } from './audit-log.entity';
import { AuditService } from './audit.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';

describe('AuditService', () => {
  const logs = {
    findAndCount: jest.fn(),
    create: jest.fn((input: Partial<AuditLog>) => input),
    save: jest.fn((input: Partial<AuditLog>) => Promise.resolve(input)),
  } as unknown as jest.Mocked<Repository<AuditLog>>;
  const service = new AuditService(logs);

  beforeEach(() => {
    jest.clearAllMocks();
    logs.findAndCount.mockResolvedValue([[], 0]);
  });

  it('scopes regular users to their own logs', async () => {
    const viewer = user('00000000-0000-4000-8000-000000000001', UserRole.User);

    await service.list(viewer, {
      actorId: '00000000-0000-4000-8000-000000000002',
      limit: 20,
      offset: 5,
    } as ListAuditLogsDto);

    expect(logs.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { actor: { id: viewer.sub } },
        take: 20,
        skip: 5,
      }),
    );
  });

  it('lets admins filter by actor and resource fields', async () => {
    const viewer = user('00000000-0000-4000-8000-000000000001', UserRole.Admin);

    await service.list(viewer, {
      actorId: '00000000-0000-4000-8000-000000000002',
      action: 'tool.command_run',
      resourceType: 'command_run',
      resourceId: 'command-1',
    } as ListAuditLogsDto);

    expect(logs.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          action: 'tool.command_run',
          resourceType: 'command_run',
          resourceId: 'command-1',
          actor: { id: '00000000-0000-4000-8000-000000000002' },
        },
        take: 50,
        skip: 0,
      }),
    );
  });

  it('lets admins list all logs when actorId is omitted', async () => {
    const viewer = user('00000000-0000-4000-8000-000000000001', UserRole.Admin);

    await service.list(viewer, {} as ListAuditLogsDto);

    expect(logs.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        relations: { actor: true },
        order: { createdAt: 'DESC' },
      }),
    );
  });
});

function user(sub: string, role: UserRole): AuthenticatedUser {
  return {
    sub,
    role,
    email: `${sub}@example.com`,
  };
}
