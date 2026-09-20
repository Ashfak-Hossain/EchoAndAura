CREATE INDEX "orders_buyer_email_idx" ON "orders" USING btree ("buyer_email");--> statement-breakpoint
CREATE INDEX "orders_buyer_phone_idx" ON "orders" USING btree ("buyer_phone");--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");