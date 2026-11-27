CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY,
	"sender" text NOT NULL,
	"recipient" text,
	"destination" text NOT NULL,
	"order" text NOT NULL,
	"resolvedRecipient" text NOT NULL,
	"amount" bigint NOT NULL,
	"network" text NOT NULL,
	"testnetEpoch" text NOT NULL,
	"contractId" text,
	"status" text NOT NULL,
	"envelope" text NOT NULL,
	"hash" text,
	"expiresAt" timestamp with time zone NOT NULL,
	"failure" text,
	"concludedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_positive_amount" CHECK ("amount" > 0),
	CONSTRAINT "transfers_signed_has_hash" CHECK ("status" = 'proposed' or "hash" is not null)
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"address" text PRIMARY KEY,
	"username" text NOT NULL UNIQUE,
	"status" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"network" text NOT NULL,
	"testnetEpoch" text NOT NULL,
	"contractId" text,
	"claimedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"attemptEnvelope" text,
	"attemptHash" text,
	"attemptExpiresAt" timestamp with time zone,
	"recoveryDraft" text,
	"recoveryEnvelope" text,
	"recoveryHash" text,
	"recoverySequence" text,
	"recoveryMinTime" timestamp with time zone,
	"recoveryMaxTime" timestamp with time zone,
	CONSTRAINT "wallets_active_has_recovery" CHECK ("status" <> 'active' or ("recoveryEnvelope" is not null and "recoveryHash" is not null and "recoverySequence" is not null and "recoveryMinTime" is not null and "recoveryMaxTime" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_one_in_flight" ON "transfers" ("sender","network","testnetEpoch") WHERE "status" = 'authorized';--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_sender_wallets_address_fkey" FOREIGN KEY ("sender") REFERENCES "wallets"("address");