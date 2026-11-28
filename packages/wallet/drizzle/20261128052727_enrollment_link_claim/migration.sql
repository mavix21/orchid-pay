ALTER TABLE "asset_orders" ADD COLUMN "enrollmentReceive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "enrollmentReceiveOrderId" uuid;