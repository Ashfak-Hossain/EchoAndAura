ALTER TABLE "events" ADD COLUMN "venue_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "venue_area" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_hidden_venue_set" CHECK (NOT "events"."venue_hidden" OR "events"."venue" IS NOT NULL);