DELETE FROM "transfers"
WHERE "order" ~ '"_tag": ?"(Issued|Native)"';
--> statement-breakpoint
DELETE FROM "asset_orders"
WHERE "order" ~ '"_tag": ?"Issued"' OR "opens" ~ '"_tag": ?"Issued"';
