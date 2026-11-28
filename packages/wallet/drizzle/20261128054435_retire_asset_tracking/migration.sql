DELETE FROM "asset_orders"
WHERE COALESCE("order"::jsonb -> 'action' ->> '_tag', '') NOT IN ('ClaimUnclaimedFunds', 'ReceiveLink', 'ReceiveLinkExternal');--> statement-breakpoint
DROP TABLE "trustlines";--> statement-breakpoint
ALTER TABLE "asset_orders" DROP COLUMN "opens";
