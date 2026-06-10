import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendPlanWorkflow1718136000000 implements MigrationInterface {
  name = 'ExtendPlanWorkflow1718136000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plans_status_enum') THEN
          ALTER TYPE "plans_status_enum" ADD VALUE IF NOT EXISTS 'planning_generating';
          ALTER TYPE "plans_status_enum" ADD VALUE IF NOT EXISTS 'plan_ready_pending_approval';
          ALTER TYPE "plans_status_enum" ADD VALUE IF NOT EXISTS 'plan_customizing';
          ALTER TYPE "plans_status_enum" ADD VALUE IF NOT EXISTS 'plan_review';
        END IF;
      END $$;
    `);
    await queryRunner.query('ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "client_request_id" character varying');
    await queryRunner.query('ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "draft_markdown" text NOT NULL DEFAULT \'\'');
    await queryRunner.query('ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "final_markdown" text');
    await queryRunner.query('ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "questions" text NOT NULL DEFAULT \'[]\'');
    await queryRunner.query('ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "answers" text NOT NULL DEFAULT \'[]\'');
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_plans_session_client_request"
      ON "plans" ("session_id", "client_request_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_plans_session_client_request"');
    await queryRunner.query('ALTER TABLE "plans" DROP COLUMN IF EXISTS "answers"');
    await queryRunner.query('ALTER TABLE "plans" DROP COLUMN IF EXISTS "questions"');
    await queryRunner.query('ALTER TABLE "plans" DROP COLUMN IF EXISTS "final_markdown"');
    await queryRunner.query('ALTER TABLE "plans" DROP COLUMN IF EXISTS "draft_markdown"');
    await queryRunner.query('ALTER TABLE "plans" DROP COLUMN IF EXISTS "client_request_id"');
  }
}
