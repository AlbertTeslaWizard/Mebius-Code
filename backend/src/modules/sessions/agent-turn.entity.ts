import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';
import { Session } from './session.entity';

export enum AgentTurnKind {
  Chat = 'chat',
  Plan = 'plan',
  PlanRevision = 'plan_revision',
  PlanDiscussion = 'plan_discussion',
  PlanApproval = 'plan_approval',
  PlanExecution = 'plan_execution',
  Legacy = 'legacy',
  ManualCommand = 'manual_command',
}

export enum AgentTurnStatus {
  Active = 'active',
  Undone = 'undone',
}

@Entity('agent_turns')
@Index('IDX_agent_turns_session_status_created', ['session', 'status', 'createdAt'])
export class AgentTurn {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: Relation<Session>;

  @Column({ type: 'varchar', default: AgentTurnKind.Chat })
  kind: AgentTurnKind;

  @Column({ type: 'varchar', default: AgentTurnStatus.Active })
  status: AgentTurnStatus;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ name: 'undone_at', type: 'timestamp', nullable: true })
  undoneAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
