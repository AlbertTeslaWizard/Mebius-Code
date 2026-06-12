import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { McpServerConfig } from './mcp-server-config.entity';
import { McpService } from './mcp.service';

@Module({
  imports: [TypeOrmModule.forFeature([McpServerConfig]), CommonModule],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
