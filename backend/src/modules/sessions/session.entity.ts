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
import { SessionStatus } from '../../common/enums/session-status.enum';
import { DEFAULT_PERMISSION_MODE, PermissionMode } from '../../common/enums/permission-mode.enum';
import { ModelConfig } from '../model-configs/model-config.entity';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: Relation<User>;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Relation<Project>;

  @ManyToOne(() => ModelConfig, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'active_model_config_id' })
  activeModelConfig?: Relation<ModelConfig> | null;

  @Column()
  title: string;

  @Column({ type: 'enum', enum: SessionStatus, default: SessionStatus.Active })
  status: SessionStatus;

  @Column({
    name: 'permission_mode',
    type: 'enum',
    enum: PermissionMode,
    default: DEFAULT_PERMISSION_MODE,
  })
  permissionMode: PermissionMode;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
