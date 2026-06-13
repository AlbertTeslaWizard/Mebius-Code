import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventsModule } from '../events/events.module';
import { ModelConfigsModule } from '../model-configs/model-configs.module';
import { ProjectsModule } from '../projects/projects.module';
import { AgentTurn } from '../sessions/agent-turn.entity';
import { SessionsModule } from '../sessions/sessions.module';
import { ToolsModule } from '../tools/tools.module';
import { UsersModule } from '../users/users.module';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { OpenAiCompatibleService } from './openai-compatible.service';
import { PlanStep } from './plan-step.entity';
import { Plan } from './plan.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Plan, PlanStep, AgentTurn]),
    EventsModule,
    ModelConfigsModule,
    ProjectsModule,
    SessionsModule,
    forwardRef(() => ToolsModule),
    UsersModule,
  ],
  controllers: [AgentController],
  providers: [AgentService, OpenAiCompatibleService],
  exports: [AgentService],
})
export class AgentModule {}
