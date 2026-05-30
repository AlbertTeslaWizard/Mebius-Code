import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { ModelConfigsModule } from '../model-configs/model-configs.module';
import { ProjectsModule } from '../projects/projects.module';
import { UsersModule } from '../users/users.module';
import { ConversationSummary } from './conversation-summary.entity';
import { Message } from './message.entity';
import { Session } from './session.entity';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Session, Message, ConversationSummary]),
    AuthModule,
    EventsModule,
    UsersModule,
    ProjectsModule,
    ModelConfigsModule,
  ],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService, TypeOrmModule],
})
export class SessionsModule {}

