CREATE TABLE "sponsored_failures" (
	"signature" text PRIMARY KEY,
	"signer" text NOT NULL,
	"landedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sponsored_failures_signer" ON "sponsored_failures" ("signer","landedAt");