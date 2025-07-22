import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1640000000000 implements MigrationInterface {
  name = 'InitialSchema1640000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create notifications table
    await queryRunner.query(`
            CREATE TYPE "notification_status_enum" AS ENUM(
                'CREATED', 'QUEUED', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED', 'CANCELLED'
            )
        `);

    await queryRunner.query(`
            CREATE TYPE "notification_channel_enum" AS ENUM(
                'EMAIL', 'SMS', 'PUSH', 'WEBHOOK'
            )
        `);

    await queryRunner.query(`
            CREATE TABLE "notifications" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "channel" "notification_channel_enum" NOT NULL,
                "recipient" varchar(255) NOT NULL,
                "subject" varchar(255),
                "content" text NOT NULL,
                "recipientVO" jsonb,
                "contentVO" jsonb,
                "status" "notification_status_enum" NOT NULL DEFAULT 'CREATED',
                "metadata" jsonb NOT NULL DEFAULT '{}',
                "retryCount" integer NOT NULL DEFAULT 0,
                "lastError" text,
                "scheduledFor" TIMESTAMP,
                "sentAt" TIMESTAMP,
                "deliveredAt" TIMESTAMP,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
            )
        `);

    // Create indexes for notifications
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_status_created" ON "notifications" ("status", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_channel_status" ON "notifications" ("channel", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_recipient" ON "notifications" ("recipient")`,
    );

    // Create API keys table
    await queryRunner.query(`
            CREATE TABLE "api_keys" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "name" varchar(255) NOT NULL,
                "hashedKey" varchar(255) NOT NULL UNIQUE,
                "keyPrefix" varchar(20) NOT NULL,
                "scopes" jsonb NOT NULL DEFAULT '[]',
                "rateLimits" jsonb NOT NULL DEFAULT '{}',
                "isActive" boolean NOT NULL DEFAULT true,
                "lastUsedAt" TIMESTAMP,
                "expiresAt" TIMESTAMP,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
            )
        `);

    // Create security audit table
    await queryRunner.query(`
            CREATE TYPE "security_event_type_enum" AS ENUM(
                'API_KEY_CREATED', 'API_KEY_DELETED', 'API_KEY_USED', 
                'INVALID_API_KEY_ATTEMPT', 'RATE_LIMIT_EXCEEDED', 
                'API_KEY_EXPIRED', 'SUSPICIOUS_ACTIVITY'
            )
        `);

    await queryRunner.query(`
            CREATE TABLE "security_audit_log" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "eventType" "security_event_type_enum" NOT NULL,
                "apiKeyId" varchar(36),
                "hashedKey" varchar(64),
                "ipAddress" varchar(45),
                "userAgent" varchar(500),
                "requestId" varchar(36),
                "organizationId" varchar(36),
                "metadata" json,
                "message" varchar(1000),
                "timestamp" TIMESTAMP NOT NULL DEFAULT now()
            )
        `);

    // Create indexes for security audit log
    await queryRunner.query(
      `CREATE INDEX "idx_security_audit_event_type" ON "security_audit_log" ("eventType")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_security_audit_timestamp" ON "security_audit_log" ("timestamp")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_security_audit_api_key_id" ON "security_audit_log" ("apiKeyId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables
    await queryRunner.query(`DROP TABLE "security_audit_log"`);
    await queryRunner.query(`DROP TABLE "api_keys"`);
    await queryRunner.query(`DROP TABLE "notifications"`);

    // Drop enums
    await queryRunner.query(`DROP TYPE "security_event_type_enum"`);
    await queryRunner.query(`DROP TYPE "notification_channel_enum"`);
    await queryRunner.query(`DROP TYPE "notification_status_enum"`);
  }
}
