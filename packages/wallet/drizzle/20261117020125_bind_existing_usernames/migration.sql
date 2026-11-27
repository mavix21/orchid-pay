INSERT INTO "usernames" ("username", "address", "boundAt")
SELECT "username", "address", "claimedAt" FROM "wallets"
WHERE NOT ("status" = 'claimed' AND NOT "ownershipBound" AND "attemptHash" IS NULL);
--> statement-breakpoint
UPDATE "wallets" SET "status" = 'opening' WHERE "status" = 'claimed';
--> statement-breakpoint
UPDATE "wallets" SET "attemptEnvelope" = NULL, "attemptHash" = NULL, "attemptExpiresAt" = NULL, "recoveryDraft" = NULL, "recoveryEnvelope" = NULL, "recoveryHash" = NULL, "recoverySequence" = NULL, "recoveryMinTime" = NULL, "recoveryMaxTime" = NULL WHERE "status" = 'recovered';
--> statement-breakpoint
UPDATE "wallets" SET "status" = 'recovered' WHERE "status" = 'reopening';
