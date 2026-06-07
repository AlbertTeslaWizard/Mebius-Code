import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
} from 'typeorm';
import { Session } from '../sessions/session.entity';
import { User } from '../users/user.entity';

export const SESSION_SHELL_AUTORUN_GRANT = 'shell_autorun';

@Entity('session_command_grants')
@Unique(['session', 'grantType'])
export class SessionCommandGrant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: Relation<Session>;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy?: Relation<User> | null;

  @Column({ name: 'grant_type', type: 'varchar', length: 64 })
  grantType: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
