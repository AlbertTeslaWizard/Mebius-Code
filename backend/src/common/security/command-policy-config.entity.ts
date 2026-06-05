import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('command_policy_configs')
export class CommandPolicyConfig {
  @PrimaryColumn({ type: 'varchar', length: 32, default: 'global' })
  id: string;

  @Column({ name: 'enabled_presets', type: 'jsonb', default: () => "'[]'::jsonb" })
  enabledPresets: string[];

  @Column({ name: 'custom_commands', type: 'jsonb', default: () => "'[]'::jsonb" })
  customCommands: string[];

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
