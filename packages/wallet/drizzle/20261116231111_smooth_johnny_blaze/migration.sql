ALTER TABLE "transfers" ADD COLUMN "sweepCheckedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "ownershipBound" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "sweepCheckedAt" timestamp with time zone;