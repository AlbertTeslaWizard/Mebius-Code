import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum EmailVerificationPurpose {
  Register = 'register',
}

@Entity('email_verification_codes')
@Index(['email', 'purpose', 'createdAt'])
@Index(['purpose', 'createdAt'])
export class EmailVerificationCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  email: string;

  @Column({ type: 'varchar', default: EmailVerificationPurpose.Register })
  purpose: EmailVerificationPurpose;

  @Column({ name: 'code_hash', select: false })
  codeHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt?: Date | null;

  @Column({ default: 0 })
  attempts: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
