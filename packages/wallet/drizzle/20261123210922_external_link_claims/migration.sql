ALTER TABLE "asset_orders" ALTER COLUMN "wallet" DROP NOT NULL;--> statement-breakpoint
DROP INDEX "asset_orders_one_in_flight";--> statement-breakpoint
CREATE UNIQUE INDEX "asset_orders_one_in_flight" ON "asset_orders" ("wallet","network","testnetEpoch") WHERE "status" = 'authorized' and "wallet" is not null;