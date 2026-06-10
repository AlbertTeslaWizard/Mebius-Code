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
import { PlanStatus } from '../../common/enums/plan-status.enum';
import { Session } from '../sessions/session.entity';
import type { PlanQuestion, PlanQuestionAnswer } from './plan-workflow.types';

const PLAN_STATUS_DB_VALUES = [
  ...Object.values(PlanStatus),
  'pending_approval',
  'rejected',
  'running',
  'completed',
];

@Entity('plans')
@Index('IDX_plans_session_client_request', ['session', 'clientRequestId'])
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: Relation<Session>;

  @Column({ type: 'enum', enum: PLAN_STATUS_DB_VALUES, default: PlanStatus.PlanningGenerating })
  status: PlanStatus;

  @Column({ type: 'text', default: '' })
  goal: string;

  @Column({ name: 'client_request_id', type: 'varchar', nullable: true })
  clientRequestId?: string | null;

  @Column({ type: 'text' })
  summary: string;

  @Column({ name: 'draft_markdown', type: 'text', default: '' })
  draftMarkdown: string;

  @Column({ name: 'final_markdown', type: 'text', nullable: true })
  finalMarkdown?: string | null;

  @Column({ type: 'simple-json', default: '[]' })
  questions: PlanQuestion[];

  @Column({ type: 'simple-json', default: '[]' })
  answers: PlanQuestionAnswer[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
