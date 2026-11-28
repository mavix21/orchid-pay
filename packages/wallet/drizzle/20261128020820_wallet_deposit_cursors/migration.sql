DELETE FROM "deposit_cursors";--> statement-breakpoint
ALTER TABLE "deposit_cursors" ADD COLUMN "wallet" text;--> statement-breakpoint
ALTER TABLE "deposit_cursors" ADD COLUMN "scannedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deposit_cursors" DROP COLUMN "contractId";--> statement-breakpoint
ALTER TABLE "deposit_cursors" DROP COLUMN "closedAt";--> statement-breakpoint
ALTER TABLE "deposit_cursors" ADD PRIMARY KEY ("network","testnetEpoch","wallet");--> statement-breakpoint
ALTER TABLE "deposit_cursors" ALTER COLUMN "cursor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deposit_cursors" ALTER COLUMN "ledger" SET DATA TYPE bigint USING "ledger"::bigint;--> statement-breakpoint
ALTER TABLE "deposit_cursors" ALTER COLUMN "ledger" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deposits" ALTER COLUMN "ledger" SET DATA TYPE bigint USING "ledger"::bigint;--> statement-breakpoint
ALTER TABLE "deposit_cursors" ADD CONSTRAINT "deposit_cursors_wallet_wallets_address_fkey" FOREIGN KEY ("wallet") REFERENCES "wallets"("address");--> statement-breakpoint
ALTER TABLE "deposit_cursors" ADD CONSTRAINT "deposit_cursors_position" CHECK (("cursor" is null) = ("ledger" is null));