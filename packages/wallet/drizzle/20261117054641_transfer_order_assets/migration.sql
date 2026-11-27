UPDATE "transfers" SET "order" = jsonb_set("order"::jsonb, '{asset}', '{"_tag":"Issued","code":"USDC","issuer":"GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"}'::jsonb)::text
WHERE NOT ("order"::jsonb ? 'asset');
