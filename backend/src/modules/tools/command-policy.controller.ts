import { Body, Controller, ForbiddenException, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '../../common/enums/user-role.enum';
import { CommandPolicyService } from '../../common/security/command-policy.service';
import { RequestWithUser } from '../../common/types/request-with-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { UpdateCommandPolicyDto } from './dto/update-command-policy.dto';

@Controller('command-policy')
@UseGuards(JwtAuthGuard)
export class CommandPolicyController {
  constructor(
    private readonly commandPolicy: CommandPolicyService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  describe(@Req() request: RequestWithUser) {
    return this.commandPolicy.describe(request.user.role === UserRole.Admin);
  }

  @Patch()
  async update(@Req() request: RequestWithUser, @Body() dto: UpdateCommandPolicyDto) {
    if (request.user.role !== UserRole.Admin) {
      throw new ForbiddenException('Only administrators can update command policy.');
    }
    await this.commandPolicy.update(dto);
    const actor = await this.users.findById(request.user.sub);
    await this.audit.record({
      actor,
      action: 'command_policy.updated',
      resourceType: 'command_policy',
      resourceId: 'global',
      metadata: {
        enabledPresets: dto.enabledPresets,
        customCommands: dto.customCommands,
      },
    });
    return this.commandPolicy.describe(true);
  }
}
