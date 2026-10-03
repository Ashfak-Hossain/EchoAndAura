CREATE TYPE "public"."door_decision" AS ENUM('turned_away', 'let_in');--> statement-breakpoint
CREATE TABLE "door_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"pass_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"decision" "door_decision" NOT NULL,
	"decided_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "door_decisions_scan_id_unique" UNIQUE("scan_id")
);
--> statement-breakpoint
ALTER TABLE "door_decisions" ADD CONSTRAINT "door_decisions_scan_id_door_scans_scan_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."door_scans"("scan_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "door_decisions" ADD CONSTRAINT "door_decisions_pass_id_door_passes_id_fk" FOREIGN KEY ("pass_id") REFERENCES "public"."door_passes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "door_decisions" ADD CONSTRAINT "door_decisions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "door_decisions_event_id_idx" ON "door_decisions" USING btree ("event_id");