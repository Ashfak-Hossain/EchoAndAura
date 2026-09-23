ALTER TABLE "promo_codes" DROP CONSTRAINT "promo_codes_value_nonneg";--> statement-breakpoint
ALTER TABLE "promo_codes" DROP CONSTRAINT "promo_codes_code_normalised";--> statement-breakpoint
ALTER TABLE "promo_codes" DROP CONSTRAINT "promo_codes_percentage_range";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_totals_consistent" CHECK ("orders"."subtotal_paisa" = "orders"."unit_price_paisa" * "orders"."quantity" AND "orders"."discount_paisa" <= "orders"."subtotal_paisa" AND "orders"."total_paisa" = "orders"."subtotal_paisa" - "orders"."discount_paisa");--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_value_positive" CHECK ("promo_codes"."value" > 0);--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_code_format" CHECK ("promo_codes"."code" ~ '^[A-Z0-9][A-Z0-9-]{1,22}[A-Z0-9]$');--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_percentage_range" CHECK ("promo_codes"."type" <> 'percentage' OR ("promo_codes"."value" >= 1 AND "promo_codes"."value" <= 99));