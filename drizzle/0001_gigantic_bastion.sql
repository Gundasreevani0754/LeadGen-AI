ALTER TABLE "businesses" ADD COLUMN "place_id" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "book_online_url" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "unclaimed_listing" boolean;--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_place_id_uniq" ON "businesses" USING btree ("place_id") WHERE "businesses"."place_id" is not null;