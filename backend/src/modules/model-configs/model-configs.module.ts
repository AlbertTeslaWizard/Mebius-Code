import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { UsersModule } from '../users/users.module';
import { ModelConfig } from './model-config.entity';
import { ModelConfigsController } from './model-configs.controller';
import { ModelConfigsService } from './model-configs.service';

@Module({
  imports: [TypeOrmModule.forFeature([ModelConfig]), CommonModule, UsersModule],
  controllers: [ModelConfigsController],
  providers: [ModelConfigsService],
  exports: [ModelConfigsService],
})
export class ModelConfigsModule {}

