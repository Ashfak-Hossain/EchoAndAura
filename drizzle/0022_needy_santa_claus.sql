CREATE TYPE "public"."door_verdict" AS ENUM('admitted', 'refused', 'practice', 'undone');--> statement-breakpoint
ALTER TABLE "door_scans" ADD COLUMN "door_verdict" "door_verdict";--> statement-breakpoint
ALTER TABLE "door_scans" ADD COLUMN "supersedes_scan_id" uuid;--> statement-breakpoint
CREATE INDEX "door_scans_offline_event_idx" ON "door_scans" USING btree ("event_id") WHERE "door_scans"."mode" = 'offline';--> statement-breakpoint
ALTER TABLE "door_scans" ADD CONSTRAINT "door_scans_verdict_offline" CHECK (("door_scans"."mode" = 'offline') = ("door_scans"."door_verdict" IS NOT NULL));