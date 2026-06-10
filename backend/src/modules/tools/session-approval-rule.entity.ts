import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';
import { Session } from '../sessions/session.entity';
import { User } from '../users/user.entity';

@Entity('session_approval_rules')
export class SessionApprovalRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: Relation<Session>;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy?: Relation<User> | null;

  @Column({ name: 'tool_kind', type: 'varchar', length: 64 })
  toolKind: string;

  @Column({ type: 'varchar', length: 256, nullable: true })
  pattern?: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  scope?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

