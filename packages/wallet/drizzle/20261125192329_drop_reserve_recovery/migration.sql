ALTER TABLE "wallets" DROP CONSTRAINT "wallets_active_has_recovery";--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "recoveryDraft";--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "recoveryEnvelope";--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "recoveryHash";--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "recoverySequence";--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "recoveryMinTime";--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "recoveryMaxTime";--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "sweepCheckedAt";--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "pairedRecoveryDraft";--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "pairedRecoveryEnvelope";--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "pairedRecoveryHash";--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "depositOpening";