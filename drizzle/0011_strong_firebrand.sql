CREATE TYPE "public"."bkash_account_type" AS ENUM('personal', 'merchant');--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"bkash_receive_number" text,
	"bkash_account_name" text,
	"bkash_account_type" "bkash_account_type" DEFAULT 'personal' NOT NULL,
	"support_email" text,
	"support_phone" text,
	"facebook_page_url" text,
	"verification_promise" text,
	"organizer_name" text,
	"organizer_address" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1)
);
