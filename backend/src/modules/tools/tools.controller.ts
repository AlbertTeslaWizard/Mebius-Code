import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RequestWithUser } from '../../common/types/request-with-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { ToolsService } from './tools.service';

@Controller('approvals')
@UseGuards(JwtAuthGuard)
export class ToolsController {
  constructor(
    private readonly tools: ToolsService,
    private readonly users: UsersService,
  ) {}

  @Get('pending')
  pending(@Req() request: RequestWithUser) {
    return this.tools.pending(request.user.sub);
  }

  @Post(':id/approve')
  async approve(@Req() request: RequestWithUser, @Param('id') id: string) {
    const owner = await this.users.findById(request.user.sub);
    return this.tools.approve(owner, id);
  }

  @Post(':id/reject')
  async reject(@Req() request: RequestWithUser, @Param('id') id: string) {
    const owner = await this.users.findById(request.user.sub);
    return this.tools.reject(owner, id);
  }
}

