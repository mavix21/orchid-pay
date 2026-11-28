DELETE FROM "asset_orders"
WHERE "order"::jsonb -> 'action' ->> '_tag' IN ('OpenTrustline', 'CloseTrustline');--> statement-breakpoint
DROP TABLE "trustlines";--> statement-breakpoint
ALTER TABLE "asset_orders" DROP COLUMN "opens";
