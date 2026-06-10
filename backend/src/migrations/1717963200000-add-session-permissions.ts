import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionPermissions1717963200000 implements MigrationInterface {
  name = 'AddSessionPermissions1717963200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sessions_permission_mode_enum') THEN
          CREATE TYPE "sessions_permission_mode_enum" AS ENUM ('read_only', 'ask_first', 'auto', 'full_access');
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "sessions"
      ADD COLUMN IF NOT EXISTS "permission_mode" "sessions_permission_mode_enum" NOT NULL DEFAULT 'ask_first'
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "session_approval_rules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "session_id" uuid NOT NULL,
        "created_by_id" uuid,
        "tool_kind" character varying(64) NOT NULL,
        "pattern" character varying(256),
        "scope" character varying(256),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_session_approval_rules_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_session_approval_rules_session'
        ) THEN
          ALTER TABLE "session_approval_rules"
          ADD CONSTRAINT "FK_session_approval_rules_session"
          FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_session_approval_rules_created_by'
        ) THEN
          ALTER TABLE "session_approval_rules"
          ADD CONSTRAINT "FK_session_approval_rules_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_session_approval_rules_session_tool"
      ON "session_approval_rules" ("session_id", "tool_kind")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_session_approval_rules_session_tool"');
    await queryRunner.query('DROP TABLE IF EXISTS "session_approval_rules"');
    await queryRunner.query('ALTER TABLE "sessions" DROP COLUMN IF EXISTS "permission_mode"');
    await queryRunner.query('DROP TYPE IF EXISTS "sessions_permission_mode_enum"');
  }
}
