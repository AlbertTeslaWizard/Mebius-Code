import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RequestWithUser } from '../../common/types/request-with-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { AgentService } from './agent.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { RunAgentDto } from './dto/run-agent.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly users: UsersService,
  ) {}

  @Post('sessions/:id/plan')
  async createPlan(
    @Req() request: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: CreatePlanDto,
  ) {
    const owner = await this.users.findById(request.user.sub);
    return this.agent.createPlan(owner, id, dto);
  }

  @Post('plans/:id/approve')
  async approvePlan(@Req() request: RequestWithUser, @Param('id') id: string) {
    const owner = await this.users.findById(request.user.sub);
    return this.agent.approvePlan(owner, id);
  }

  @Post('sessions/:id/run')
  async run(@Req() request: RequestWithUser, @Param('id') id: string, @Body() dto: RunAgentDto) {
    const owner = await this.users.findById(request.user.sub);
    return this.agent.run(owner, id, dto);
  }
}

