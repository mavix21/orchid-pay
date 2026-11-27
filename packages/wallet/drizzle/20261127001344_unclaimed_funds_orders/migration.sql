DELETE FROM "asset_orders"
WHERE "order"::jsonb -> 'action' ->> '_tag' NOT IN ('OpenTrustline', 'CloseTrustline')
  AND NOT "order"::jsonb -> 'action' ? 'unclaimedFunds';
