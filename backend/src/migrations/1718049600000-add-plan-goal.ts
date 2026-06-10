import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlanGoal1718049600000 implements MigrationInterface {
  name = 'AddPlanGoal1718049600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "plans"
      ADD COLUMN IF NOT EXISTS "goal" text NOT NULL DEFAULT ''
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "plans" DROP COLUMN IF EXISTS "goal"');
  }
}
