CREATE TABLE "payment_requests" (
	"id" text PRIMARY KEY,
	"requester" text NOT NULL,
	"network" text NOT NULL,
	"testnetEpoch" text NOT NULL,
	"assetId" text NOT NULL,
	"assetCode" text NOT NULL,
	"amount" bigint NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelledAt" timestamp with time zone,
	CONSTRAINT "payment_requests_positive_amount" CHECK ("amount" > 0),
	CONSTRAINT "payment_requests_cancelled_at" CHECK ("status" <> 'cancelled' or "cancelledAt" is not null)
);
--> statement-breakpoint
CREATE INDEX "payment_requests_open" ON "payment_requests" ("requester","network","testnetEpoch","createdAt") WHERE "status" = 'open';--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_requester_usernames_username_fkey" FOREIGN KEY ("requester") REFERENCES "usernames"("username");