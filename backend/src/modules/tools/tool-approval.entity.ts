import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';
import { ApprovalStatus } from '../../common/enums/tool-status.enum';
import { User } from '../users/user.entity';
import { ToolCall } from './tool-call.entity';

@Entity('tool_approvals')
export class ToolApproval {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => ToolCall, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tool_call_id' })
  toolCall: Relation<ToolCall>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requester_id' })
  requester: Relation<User>;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approver_id' })
  approver?: Relation<User> | null;

  @Column({ type: 'enum', enum: ApprovalStatus, default: ApprovalStatus.Pending })
  status: ApprovalStatus;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

