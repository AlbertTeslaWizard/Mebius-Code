import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentTurns1718222400000 implements MigrationInterface {
  name = 'AddAgentTurns1718222400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_turns" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "session_id" uuid NOT NULL,
        "kind" character varying NOT NULL DEFAULT 'chat',
        "status" character varying NOT NULL DEFAULT 'active',
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "undone_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_turns" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_agent_turns_session'
        ) THEN
          ALTER TABLE "agent_turns"
          ADD CONSTRAINT "FK_agent_turns_session"
          FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
    await queryRunner.query('ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "turn_id" uuid');
    await queryRunner.query('ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP');
    await queryRunner.query('ALTER TABLE "tool_calls" ADD COLUMN IF NOT EXISTS "turn_id" uuid');
    await queryRunner.query('ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "turn_id" uuid');
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_messages_turn'
        ) THEN
          ALTER TABLE "messages"
          ADD CONSTRAINT "FK_messages_turn"
          FOREIGN KEY ("turn_id") REFERENCES "agent_turns"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_tool_calls_turn'
        ) THEN
          ALTER TABLE "tool_calls"
          ADD CONSTRAINT "FK_tool_calls_turn"
          FOREIGN KEY ("turn_id") REFERENCES "agent_turns"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_plans_turn'
        ) THEN
          ALTER TABLE "plans"
          ADD CONSTRAINT "FK_plans_turn"
          FOREIGN KEY ("turn_id") REFERENCES "agent_turns"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_agent_turns_session_status_created"
      ON "agent_turns" ("session_id", "status", "created_at")
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_messages_turn" ON "messages" ("turn_id")');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_tool_calls_turn" ON "tool_calls" ("turn_id")');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_plans_turn" ON "plans" ("turn_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_plans_turn"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_tool_calls_turn"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_messages_turn"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_agent_turns_session_status_created"');
    await queryRunner.query('ALTER TABLE "plans" DROP CONSTRAINT IF EXISTS "FK_plans_turn"');
    await queryRunner.query('ALTER TABLE "tool_calls" DROP CONSTRAINT IF EXISTS "FK_tool_calls_turn"');
    await queryRunner.query('ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "FK_messages_turn"');
    await queryRunner.query('ALTER TABLE "plans" DROP COLUMN IF EXISTS "turn_id"');
    await queryRunner.query('ALTER TABLE "tool_calls" DROP COLUMN IF EXISTS "turn_id"');
    await queryRunner.query('ALTER TABLE "messages" DROP COLUMN IF EXISTS "deleted_at"');
    await queryRunner.query('ALTER TABLE "messages" DROP COLUMN IF EXISTS "turn_id"');
    await queryRunner.query('ALTER TABLE "agent_turns" DROP CONSTRAINT IF EXISTS "FK_agent_turns_session"');
    await queryRunner.query('DROP TABLE IF EXISTS "agent_turns"');
  }
}
