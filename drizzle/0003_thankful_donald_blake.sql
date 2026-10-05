CREATE TABLE "legacy_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid,
	"source" text NOT NULL,
	"company_name" text NOT NULL,
	"contact_person" text,
	"designation" text,
	"contact_email" text,
	"contact_linkedin_url" text,
	"company_linkedin_url" text,
	"company_location" text,
	"company_size" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text,
	"source" text NOT NULL,
	"offering" text,
	"target_client" text,
	"region" text,
	"lead_count" integer,
	"searched_at" timestamp with time zone,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legacy_leads" ADD CONSTRAINT "legacy_leads_search_id_legacy_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."legacy_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_leads_dedupe" ON "legacy_leads" USING btree ("source","company_name","contact_email");