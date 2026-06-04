import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';
import { FilePatchStatus } from '../../common/enums/tool-status.enum';
import { Project } from '../projects/project.entity';
import { Session } from '../sessions/session.entity';
import { ToolCall } from './tool-call.entity';

@Entity('file_patches')
export class FilePatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Relation<Project>;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: Relation<Session>;

  @ManyToOne(() => ToolCall, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tool_call_id' })
  toolCall: Relation<ToolCall>;

  @Column({ name: 'relative_path' })
  relativePath: string;

  @Column({ name: 'original_content', type: 'text', nullable: true })
  originalContent?: string;

  @Column({ name: 'patched_content', type: 'text' })
  patchedContent: string;

  @Column({ name: 'diff_text', type: 'text' })
  diffText: string;

  @Column({ type: 'enum', enum: FilePatchStatus, default: FilePatchStatus.Proposed })
  status: FilePatchStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
