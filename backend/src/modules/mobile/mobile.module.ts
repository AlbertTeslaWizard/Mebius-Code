import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Plan } from '../agent/plan.entity';
import { AuthModule } from '../auth/auth.module';
import { ModelConfigsModule } from '../model-configs/model-configs.module';
import { Project } from '../projects/project.entity';
import { Session } from '../sessions/session.entity';
import { SystemModule } from '../system/system.module';
import { ToolApproval } from '../tools/tool-approval.entity';
import { ToolCall } from '../tools/tool-call.entity';
import { MobileController } from './mobile.controller';
import { MobileService } from './mobile.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, Session, Plan, ToolApproval, ToolCall]),
    AuthModule,
    SystemModule,
    ModelConfigsModule,
  ],
  controllers: [MobileController],
  providers: [MobileService],
})
export class MobileModule {}
