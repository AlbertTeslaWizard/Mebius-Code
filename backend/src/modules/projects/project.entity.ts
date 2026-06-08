import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum ProjectSourceType {
  Manual = 'manual',
  Git = 'git',
  Archive = 'archive',
  Local = 'local',
}

export enum ProjectWorkspaceMode {
  Managed = 'managed',
  Attached = 'attached',
}

export enum ProjectDeletePolicy {
  DeleteManagedFilesAllowed = 'delete_managed_files_allowed',
  DbRecordOnly = 'db_record_only',
}

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: Relation<User>;

  @Column()
  name: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ type: 'enum', enum: ProjectSourceType, name: 'source_type', default: ProjectSourceType.Manual })
  sourceType: ProjectSourceType;

  @Column({
    type: 'enum',
    enum: ProjectWorkspaceMode,
    name: 'workspace_mode',
    default: ProjectWorkspaceMode.Managed,
  })
  workspaceMode: ProjectWorkspaceMode;

  @Column({
    type: 'enum',
    enum: ProjectDeletePolicy,
    name: 'delete_policy',
    default: ProjectDeletePolicy.DeleteManagedFilesAllowed,
  })
  deletePolicy: ProjectDeletePolicy;

  @Column({ type: 'varchar', name: 'git_url', nullable: true })
  gitUrl?: string | null;

  @Column({ name: 'workspace_path' })
  workspacePath: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
