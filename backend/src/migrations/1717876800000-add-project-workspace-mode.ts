import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectWorkspaceMode1717876800000 implements MigrationInterface {
  name = 'AddProjectWorkspaceMode1717876800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'projects_source_type_enum') THEN
          ALTER TYPE "projects_source_type_enum" ADD VALUE IF NOT EXISTS 'local';
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'projects_workspace_mode_enum') THEN
          CREATE TYPE "projects_workspace_mode_enum" AS ENUM ('managed', 'attached');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'projects_delete_policy_enum') THEN
          CREATE TYPE "projects_delete_policy_enum" AS ENUM ('delete_managed_files_allowed', 'db_record_only');
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "projects"
      ADD COLUMN IF NOT EXISTS "workspace_mode" "projects_workspace_mode_enum" NOT NULL DEFAULT 'managed'
    `);
    await queryRunner.query(`
      ALTER TABLE "projects"
      ADD COLUMN IF NOT EXISTS "delete_policy" "projects_delete_policy_enum" NOT NULL DEFAULT 'delete_managed_files_allowed'
    `);
    await queryRunner.query(`
      UPDATE "projects"
      SET "workspace_mode" = 'managed'
      WHERE "workspace_mode" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "projects"
      SET "delete_policy" = 'delete_managed_files_allowed'
      WHERE "delete_policy" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "projects" DROP COLUMN IF EXISTS "delete_policy"');
    await queryRunner.query('ALTER TABLE "projects" DROP COLUMN IF EXISTS "workspace_mode"');
    await queryRunner.query('DROP TYPE IF EXISTS "projects_delete_policy_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "projects_workspace_mode_enum"');
  }
}
