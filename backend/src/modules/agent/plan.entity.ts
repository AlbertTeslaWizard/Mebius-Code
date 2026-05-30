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
import { PlanStatus } from '../../common/enums/plan-status.enum';
import { Session } from '../sessions/session.entity';

@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: Relation<Session>;

  @Column({ type: 'enum', enum: PlanStatus, default: PlanStatus.PendingApproval })
  status: PlanStatus;

  @Column({ type: 'text' })
  summary: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

