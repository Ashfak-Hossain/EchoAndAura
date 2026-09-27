CREATE TYPE "public"."sponsor_level" AS ENUM('presenting', 'partner', 'supporter');--> statement-breakpoint
CREATE TYPE "public"."sponsor_tile_tone" AS ENUM('light', 'dark');--> statement-breakpoint
CREATE TABLE "sponsors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"website_url" text,
	"level" "sponsor_level" NOT NULL,
	"logo_key" text NOT NULL,
	"logo_width" double precision NOT NULL,
	"logo_height" double precision NOT NULL,
	"tile_tone" "sponsor_tile_tone" DEFAULT 'light' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsors_logo_key_unique" UNIQUE("logo_key"),
	CONSTRAINT "sponsors_logo_width_positive" CHECK ("sponsors"."logo_width" > 0),
	CONSTRAINT "sponsors_logo_height_positive" CHECK ("sponsors"."logo_height" > 0),
	CONSTRAINT "sponsors_position_positive" CHECK ("sponsors"."position" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sponsors_one_presenting" ON "sponsors" USING btree ("level") WHERE "sponsors"."level" = 'presenting';