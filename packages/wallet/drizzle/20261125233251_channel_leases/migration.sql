CREATE TABLE "channel_leases" (
	"address" text PRIMARY KEY,
	"sequence" bigint NOT NULL,
	"leasedUntil" timestamp with time zone NOT NULL
);
