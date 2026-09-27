ALTER TABLE "promo_code_ticket_types" DROP CONSTRAINT "promo_code_ticket_types_ticket_type_id_ticket_types_id_fk";
--> statement-breakpoint
ALTER TABLE "promo_code_ticket_types" ADD CONSTRAINT "promo_code_ticket_types_ticket_type_id_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_promo_code_id_idx" ON "orders" USING btree ("promo_code_id");--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_code_normalised" CHECK ("promo_codes"."code" = upper(btrim("promo_codes"."code")));