ALTER TABLE "wallets" DROP CONSTRAINT "wallets_username_key";--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "username";--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "claimedAt";--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "ownershipBound";