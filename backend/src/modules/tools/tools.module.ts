import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { EventsModule } from '../events/events.module';
import { SessionsModule } from '../sessions/sessions.module';
import { UsersModule } from '../users/users.module';
import { CommandRun } from './command-run.entity';
import { FilePatch } from './file-patch.entity';
import { ToolApproval } from './tool-approval.entity';
import { ToolCall } from './tool-call.entity';
import { ToolsController } from './tools.controller';
import { ToolsService } from './tools.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ToolCall, ToolApproval, FilePatch, CommandRun]),
    CommonModule,
    AuditModule,
    EventsModule,
    SessionsModule,
    UsersModule,
  ],
  controllers: [ToolsController],
  providers: [ToolsService],
  exports: [ToolsService],
})
export class ToolsModule {}

