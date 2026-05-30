import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentModule } from './modules/agent/agent.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { EventsModule } from './modules/events/events.module';
import { ModelConfigsModule } from './modules/model-configs/model-configs.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { ToolsModule } from './modules/tools/tools.module';
import { UsersModule } from './modules/users/users.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DATABASE_HOST') ?? 'localhost',
        port: Number(config.get<string>('DATABASE_PORT') ?? 5432),
        username: config.get<string>('DATABASE_USER') ?? 'mebius',
        password: config.get<string>('DATABASE_PASSWORD') ?? 'mebius_dev_password',
        database: config.get<string>('DATABASE_NAME') ?? 'mebius_code',
        synchronize: (config.get<string>('DATABASE_SYNCHRONIZE') ?? 'false') === 'true',
        autoLoadEntities: true,
      }),
    }),
    UsersModule,
    AuthModule,
    AuditModule,
    EventsModule,
    ModelConfigsModule,
    ProjectsModule,
    SessionsModule,
    ToolsModule,
    AgentModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
