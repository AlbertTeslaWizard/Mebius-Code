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
import { User } from '../users/user.entity';

export enum McpTransport {
  StreamableHttp = 'streamable_http',
}

@Entity('mcp_server_configs')
@Index('IDX_mcp_server_configs_owner_slug', ['owner', 'slug'], { unique: true })
export class McpServerConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: Relation<User>;

  @Column()
  name: string;

  @Column()
  slug: string;

  @Column()
  url: string;

  @Column({ type: 'varchar', default: McpTransport.StreamableHttp })
  transport: McpTransport;

  @Column({ default: true })
  enabled: boolean;

  @Column({ name: 'encrypted_headers', type: 'text', nullable: true })
  encryptedHeaders?: string | null;

  @Column({ name: 'is_preset', default: false })
  isPreset: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
