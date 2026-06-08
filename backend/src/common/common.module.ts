import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommandPolicyConfig } from './security/command-policy-config.entity';
import { CommandPolicyService } from './security/command-policy.service';
import { EncryptionService } from './security/encryption.service';
import { LocalWorkspaceGuard } from './security/local-workspace.guard';
import { PathSandboxService } from './security/path-sandbox.service';
import { ProjectCommandPermission } from './security/project-command-permission.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CommandPolicyConfig, ProjectCommandPermission])],
  providers: [EncryptionService, PathSandboxService, CommandPolicyService, LocalWorkspaceGuard],
  exports: [EncryptionService, PathSandboxService, CommandPolicyService, LocalWorkspaceGuard],
})
export class CommonModule {}
