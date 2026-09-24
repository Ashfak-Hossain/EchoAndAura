CREATE TYPE "public"."door_scan_method" AS ENUM('qr', 'typed', 'search');--> statement-breakpoint
CREATE TYPE "public"."door_scan_mode" AS ENUM('online', 'offline', 'practice');--> statement-breakpoint
CREATE TYPE "public"."door_scan_result" AS ENUM('admitted', 'already_in', 'cancelled', 'wrong_event', 'unknown', 'practice_ok');--> statement-breakpoint
CREATE TABLE "door_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"label" text NOT NULL,
	"code" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "door_passes_code_unique" UNIQUE("code"),
	CONSTRAINT "door_passes_code_format" CHECK ("door_passes"."code" ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$')
);
--> statement-breakpoint
CREATE TABLE "door_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"pass_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_id" uuid,
	"input" text NOT NULL,
	"result" "door_scan_result" NOT NULL,
	"method" "door_scan_method" NOT NULL,
	"mode" "door_scan_mode" NOT NULL,
	"prior_checked_in_at" timestamp with time zone,
	"prior_checked_in_by" text,
	"scanned_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "door_scans_scan_id_unique" UNIQUE("scan_id")
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "checked_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "checked_in_by" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "checked_in_scan_id" uuid;--> statement-breakpoint
ALTER TABLE "door_passes" ADD CONSTRAINT "door_passes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "door_scans" ADD CONSTRAINT "door_scans_pass_id_door_passes_id_fk" FOREIGN KEY ("pass_id") REFERENCES "public"."door_passes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "door_scans" ADD CONSTRAINT "door_scans_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "door_scans" ADD CONSTRAINT "door_scans_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "door_passes_event_id_idx" ON "door_passes" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "door_scans_pass_id_idx" ON "door_scans" USING btree ("pass_id","received_at");--> statement-breakpoint
CREATE INDEX "door_scans_event_id_idx" ON "door_scans" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "door_scans_ticket_id_idx" ON "door_scans" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "tickets_event_checked_in_idx" ON "tickets" USING btree ("event_id","checked_in_at");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_check_in_consistent" CHECK (("tickets"."checked_in_at" IS NULL) = ("tickets"."checked_in_by" IS NULL) AND ("tickets"."checked_in_at" IS NULL) = ("tickets"."checked_in_scan_id" IS NULL));--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_checked_in_is_issued" CHECK ("tickets"."checked_in_at" IS NULL OR "tickets"."status" = 'issued');