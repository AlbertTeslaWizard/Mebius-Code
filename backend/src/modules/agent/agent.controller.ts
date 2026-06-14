import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { RequestWithUser } from '../../common/types/request-with-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { AgentService } from './agent.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { DiscussPlanDto } from './dto/discuss-plan.dto';
import { RevisePlanDto } from './dto/revise-plan.dto';
import { RunAgentDto } from './dto/run-agent.dto';
import { UpdatePlanAnswersDto } from './dto/update-plan-answers.dto';

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

  @Get('sessions/:id/plans/latest')
  latestPlan(@Req() request: RequestWithUser, @Param('id') id: string) {
    return this.agent.latestPlan(request.user.sub, id);
  }

  @Post('plans/:id/approve')
  async approvePlan(@Req() request: RequestWithUser, @Param('id') id: string) {
    const owner = await this.users.findById(request.user.sub);
    return this.agent.approvePlan(owner, id);
  }

  @Post('plans/:id/revise')
  async revisePlan(
    @Req() request: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: RevisePlanDto,
  ) {
    const owner = await this.users.findById(request.user.sub);
    return this.agent.revisePlan(owner, id, dto);
  }

  @Post('plans/:id/discuss')
  async discussPlan(
    @Req() request: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: DiscussPlanDto,
  ) {
    const owner = await this.users.findById(request.user.sub);
    return this.agent.discussPlan(owner, id, dto);
  }

  @Patch('plans/:id/answers')
  async updatePlanAnswers(
    @Req() request: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdatePlanAnswersDto,
  ) {
    const owner = await this.users.findById(request.user.sub);
    return this.agent.updatePlanAnswers(owner, id, dto);
  }

  @Post('plans/:id/finalize')
  async finalizePlan(@Req() request: RequestWithUser, @Param('id') id: string) {
    const owner = await this.users.findById(request.user.sub);
    return this.agent.finalizePlan(owner, id);
  }

  @Post('plans/:id/cancel')
  async cancelPlan(@Req() request: RequestWithUser, @Param('id') id: string) {
    const owner = await this.users.findById(request.user.sub);
    return this.agent.cancelPlan(owner, id);
  }

  @Post('sessions/:id/run')
  async run(@Req() request: RequestWithUser, @Param('id') id: string, @Body() dto: RunAgentDto) {
    const owner = await this.users.findById(request.user.sub);
    return this.agent.run(owner, id, dto);
  }
}
