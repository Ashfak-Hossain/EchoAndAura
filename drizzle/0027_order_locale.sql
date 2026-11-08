CREATE TYPE "public"."locale" AS ENUM('en', 'bn');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "locale" "locale" DEFAULT 'en' NOT NULL;