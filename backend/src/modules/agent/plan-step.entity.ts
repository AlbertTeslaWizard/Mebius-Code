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
import { PlanStepStatus } from '../../common/enums/plan-step-status.enum';
import { Plan } from './plan.entity';

@Entity('plan_steps')
export class PlanStep {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Plan, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan: Relation<Plan>;

  @Column()
  order: number;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  detail?: string;

  @Column({ type: 'enum', enum: PlanStepStatus, default: PlanStepStatus.Pending })
  status: PlanStepStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

