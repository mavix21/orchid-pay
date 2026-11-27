CREATE TABLE "asset_orders" (
	"id" uuid PRIMARY KEY,
	"wallet" text NOT NULL,
	"order" text NOT NULL,
	"opens" text,
	"network" text NOT NULL,
	"testnetEpoch" text NOT NULL,
	"status" text NOT NULL,
	"envelope" text NOT NULL,
	"hash" text,
	"expiresAt" timestamp with time zone NOT NULL,
	"failure" text,
	"concludedAt" timestamp with time zone,
	"sweepCheckedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_orders_signed_has_hash" CHECK ("status" = 'proposed' or "hash" is not null)
);
--> statement-breakpoint
CREATE TABLE "trustlines" (
	"address" text,
	"network" text,
	"testnetEpoch" text,
	"code" text,
	"issuer" text,
	"openedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trustlines_pkey" PRIMARY KEY("address","network","testnetEpoch","code","issuer")
);
--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "balanceId" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "balanceClosedAt" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_orders_one_in_flight" ON "asset_orders" ("wallet","network","testnetEpoch") WHERE "status" = 'authorized';--> statement-breakpoint
CREATE INDEX "transfers_open_balances" ON "transfers" ("balanceId") WHERE "balanceId" is not null and "balanceClosedAt" is null;--> statement-breakpoint
ALTER TABLE "asset_orders" ADD CONSTRAINT "asset_orders_wallet_wallets_address_fkey" FOREIGN KEY ("wallet") REFERENCES "wallets"("address");--> statement-breakpoint
ALTER TABLE "trustlines" ADD CONSTRAINT "trustlines_address_wallets_address_fkey" FOREIGN KEY ("address") REFERENCES "wallets"("address");