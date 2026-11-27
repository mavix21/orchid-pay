CREATE TABLE "usernames" (
	"username" text PRIMARY KEY,
	"address" text NOT NULL UNIQUE,
	"boundAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usernames" ADD CONSTRAINT "usernames_address_wallets_address_fkey" FOREIGN KEY ("address") REFERENCES "wallets"("address");