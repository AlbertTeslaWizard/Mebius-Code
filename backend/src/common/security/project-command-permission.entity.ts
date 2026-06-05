import {
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  Column,
  Unique,
} from 'typeorm';
import { Project } from '../../modules/projects/project.entity';
import { User } from '../../modules/users/user.entity';

@Entity('project_command_permissions')
@Unique(['project', 'command'])
export class ProjectCommandPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Relation<Project>;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy?: Relation<User> | null;

  @Column({ type: 'text' })
  command: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
