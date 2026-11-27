CREATE TABLE "backups" (
	"credentialId" text PRIMARY KEY,
	"address" text NOT NULL,
	"username" text NOT NULL,
	"publicKey" text NOT NULL,
	"algorithm" text NOT NULL,
	"counter" bigint NOT NULL,
	"iv" text NOT NULL,
	"ciphertext" text NOT NULL,
	"enrolledAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey_challenges" (
	"challenge" text PRIMARY KEY,
	"purpose" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL
);
