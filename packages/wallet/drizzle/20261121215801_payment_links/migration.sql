ALTER TABLE "asset_orders" ADD COLUMN "balanceId" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "claimableKind" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "attemptBalanceIds" text;--> statement-breakpoint
UPDATE "transfers" SET "claimableKind" = 'username' WHERE "balanceId" IS NOT NULL AND "claimableKind" IS NULL;--> statement-breakpoint
UPDATE "transfers" SET "attemptBalanceIds" = jsonb_build_array("balanceId")::text WHERE "balanceId" IS NOT NULL AND "attemptBalanceIds" IS NULL;--> statement-breakpoint
UPDATE "asset_orders" SET "balanceId" = ("order"::jsonb -> 'action' ->> 'balance') WHERE "balanceId" IS NULL AND ("order"::jsonb -> 'action' ->> '_tag') = 'ClaimBalance';