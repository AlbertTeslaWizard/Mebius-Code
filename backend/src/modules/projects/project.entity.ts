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

  @Column({ name: 'git_url', nullable: true })
  gitUrl?: string;

  @Column({ name: 'workspace_path' })
  workspacePath: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

