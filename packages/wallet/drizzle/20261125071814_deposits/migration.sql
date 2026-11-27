CREATE TABLE "deposit_cursors" (
	"network" text,
	"testnetEpoch" text,
	"contractId" text,
	"cursor" text NOT NULL,
	"ledger" integer NOT NULL,
	"closedAt" timestamp with time zone,
	CONSTRAINT "deposit_cursors_pkey" PRIMARY KEY("network","testnetEpoch","contractId")
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"network" text NOT NULL,
	"testnetEpoch" text NOT NULL,
	"eventId" text NOT NULL,
	"wallet" text NOT NULL,
	"code" text NOT NULL,
	"issuer" text NOT NULL,
	"amount" bigint NOT NULL,
	"sender" text NOT NULL,
	"hash" text NOT NULL,
	"ledger" integer NOT NULL,
	"closedAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_positive_amount" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_event" ON "deposits" ("network","testnetEpoch","eventId");--> statement-breakpoint
CREATE INDEX "deposits_wallet_closed" ON "deposits" ("wallet","closedAt");--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_wallet_wallets_address_fkey" FOREIGN KEY ("wallet") REFERENCES "wallets"("address");