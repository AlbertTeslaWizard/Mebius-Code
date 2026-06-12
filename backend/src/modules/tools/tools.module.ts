import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { AgentModule } from '../agent/agent.module';
import { AuditModule } from '../audit/audit.module';
import { EventsModule } from '../events/events.module';
import { McpModule } from '../mcp/mcp.module';
import { Plan } from '../agent/plan.entity';
import { AgentTurn } from '../sessions/agent-turn.entity';
import { SessionsModule } from '../sessions/sessions.module';
import { Message } from '../sessions/message.entity';
import { UsersModule } from '../users/users.module';
import { CommandRun } from './command-run.entity';
import { CommandPolicyController } from './command-policy.controller';
import { FilePatch } from './file-patch.entity';
import { SessionApprovalRule } from './session-approval-rule.entity';
import { SessionCommandGrant } from './session-command-grant.entity';
import { ToolApproval } from './tool-approval.entity';
import { ToolCall } from './tool-call.entity';
import { ToolsController, ToolsReadController } from './tools.controller';
import { ToolsService } from './tools.service';
import { WebSearchService } from './web-search.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ToolCall,
      ToolApproval,
      FilePatch,
      CommandRun,
      SessionCommandGrant,
      SessionApprovalRule,
      Message,
      AgentTurn,
      Plan,
    ]),
    CommonModule,
    forwardRef(() => AgentModule),
    AuditModule,
    EventsModule,
    McpModule,
    SessionsModule,
    UsersModule,
  ],
  controllers: [ToolsController, ToolsReadController, CommandPolicyController],
  providers: [ToolsService, WebSearchService],
  exports: [ToolsService],
})
export class ToolsModule {}
