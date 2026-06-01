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
import { User } from '../users/user.entity';

@Entity('model_configs')
export class ModelConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: Relation<User>;

  @Column({ name: 'display_name' })
  displayName: string;

  @Column({ name: 'base_url' })
  baseUrl: string;

  @Column({ name: 'model_name' })
  modelName: string;

  @Column({ name: 'provider_id', type: 'varchar', nullable: true })
  providerId?: string | null;

  @Column({ name: 'encrypted_api_key' })
  encryptedApiKey: string;

  @Column({ name: 'supports_tools', default: true })
  supportsTools: boolean;

  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
