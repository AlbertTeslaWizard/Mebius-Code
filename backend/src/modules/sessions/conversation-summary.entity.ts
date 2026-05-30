import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';
import { Session } from './session.entity';

@Entity('conversation_summaries')
export class ConversationSummary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: Relation<Session>;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'token_estimate', default: 0 })
  tokenEstimate: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

