CREATE TABLE "external_payments" (
	"reference" text PRIMARY KEY,
	"request" text NOT NULL,
	"payer" text NOT NULL,
	"requester" text NOT NULL,
	"transaction" text NOT NULL,
	"envelope" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "external_payments_request" ON "external_payments" ("request");--> statement-breakpoint
ALTER TABLE "external_payments" ADD CONSTRAINT "external_payments_request_payment_requests_id_fkey" FOREIGN KEY ("request") REFERENCES "payment_requests"("id");