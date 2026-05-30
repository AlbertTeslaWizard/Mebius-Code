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
import { ToolCallStatus } from '../../common/enums/tool-status.enum';
import { Session } from '../sessions/session.entity';

@Entity('tool_calls')
export class ToolCall {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: Relation<Session>;

  @Column()
  name: string;

  @Column({ type: 'jsonb', default: {} })
  arguments: Record<string, unknown>;

  @Column({ type: 'enum', enum: ToolCallStatus, default: ToolCallStatus.Requested })
  status: ToolCallStatus;

  @Column({ name: 'requires_approval', default: false })
  requiresApproval: boolean;

  @Column({ name: 'result_text', type: 'text', nullable: true })
  resultText?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

