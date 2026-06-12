import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMcpServerConfigs1718308800000 implements MigrationInterface {
  name = 'AddMcpServerConfigs1718308800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "mcp_server_configs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "owner_id" uuid NOT NULL,
        "name" character varying NOT NULL,
        "slug" character varying NOT NULL,
        "url" character varying NOT NULL,
        "transport" character varying NOT NULL DEFAULT 'streamable_http',
        "enabled" boolean NOT NULL DEFAULT true,
        "encrypted_headers" text,
        "is_preset" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_mcp_server_configs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_mcp_server_configs_owner'
        ) THEN
          ALTER TABLE "mcp_server_configs"
          ADD CONSTRAINT "FK_mcp_server_configs_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_mcp_server_configs_owner_slug"
      ON "mcp_server_configs" ("owner_id", "slug")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_mcp_server_configs_owner_slug"');
    await queryRunner.query('ALTER TABLE "mcp_server_configs" DROP CONSTRAINT IF EXISTS "FK_mcp_server_configs_owner"');
    await queryRunner.query('DROP TABLE IF EXISTS "mcp_server_configs"');
  }
}
