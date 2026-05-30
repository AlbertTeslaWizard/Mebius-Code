import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';
import { CommandRunStatus } from '../../common/enums/tool-status.enum';
import { Project } from '../projects/project.entity';
import { Session } from '../sessions/session.entity';
import { ToolCall } from './tool-call.entity';

@Entity('command_runs')
export class CommandRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Relation<Project>;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: Relation<Session>;

  @OneToOne(() => ToolCall, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tool_call_id' })
  toolCall: Relation<ToolCall>;

  @Column()
  command: string;

  @Column({ nullable: true })
  cwd?: string;

  @Column({ name: 'exit_code', nullable: true })
  exitCode?: number;

  @Column({ type: 'text', default: '' })
  stdout: string;

  @Column({ type: 'text', default: '' })
  stderr: string;

  @Column({ type: 'enum', enum: CommandRunStatus, default: CommandRunStatus.Pending })
  status: CommandRunStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

