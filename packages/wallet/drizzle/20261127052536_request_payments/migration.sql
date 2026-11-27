ALTER TABLE "payment_requests" ADD COLUMN "payment" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "paymentExpiresAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "paidAt" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_payment" ON "payment_requests" ("payment") WHERE "payment" is not null;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_paid_by_payment" CHECK ("status" <> 'paid' or ("payment" is not null and "paidAt" is not null));--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_cancelled_unbound" CHECK ("status" <> 'cancelled' or "payment" is null);--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_binding_expires" CHECK ("status" <> 'open' or (("payment" is null) = ("paymentExpiresAt" is null)));