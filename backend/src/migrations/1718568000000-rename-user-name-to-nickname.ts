import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameUserNameToNickname1718568000000 implements MigrationInterface {
  name = 'RenameUserNameToNickname1718568000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'name'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'nickname'
        ) THEN
          ALTER TABLE "users" RENAME COLUMN "name" TO "nickname";
        END IF;
      END
      $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'nickname'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'name'
        ) THEN
          ALTER TABLE "users" RENAME COLUMN "nickname" TO "name";
        END IF;
      END
      $$;
    `);
  }
}
