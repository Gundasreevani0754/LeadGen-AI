CREATE TYPE "public"."business_status" AS ENUM('operational', 'closed_temporarily', 'closed_permanently');--> statement-breakpoint
CREATE TYPE "public"."contact_tier" AS ENUM('phone', 'email', 'linkedin', 'social', 'form', 'none');--> statement-breakpoint
CREATE TYPE "public"."crawl_status" AS ENUM('ok', 'blocked', 'no_site', 'failed');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('business', 'service_provider');--> statement-breakpoint
CREATE TYPE "public"."pipeline_status" AS ENUM('new', 'qualified', 'contacted', 'replied', 'call_booked', 'won', 'dead');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('serpapi', 'apify');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('dead', 'do_not_contact', 'bounced');--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"pain_hypothesis" text NOT NULL,
	"opening_line" text NOT NULL,
	"audit_markdown" text NOT NULL,
	"model" text NOT NULL,
	"effort" text NOT NULL,
	"session_id" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"regenerated_count" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone_raw" text,
	"phone_e164" text,
	"website_url" text,
	"root_domain" text,
	"address" text,
	"city" text,
	"region" text,
	"country_code" text,
	"lat" double precision,
	"lng" double precision,
	"google_rating" numeric(2, 1),
	"google_review_count" integer,
	"google_category" text,
	"google_maps_url" text,
	"newest_review_at" timestamp with time zone,
	"business_status" "business_status" DEFAULT 'operational' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrichment" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"whatsapp_phone" text,
	"linkedin_url" text,
	"instagram_url" text,
	"facebook_url" text,
	"x_url" text,
	"contact_form_url" text,
	"tech_stack" text[],
	"has_booking" boolean,
	"has_chat" boolean,
	"has_online_payment" boolean,
	"domain_registered_at" date,
	"domain_age_years" numeric(5, 2),
	"crawl_status" "crawl_status" NOT NULL,
	"crawl_error" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"status" "pipeline_status" DEFAULT 'new' NOT NULL,
	"owner_note" text,
	"next_action_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"from_status" "pipeline_status",
	"to_status" "pipeline_status" NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_results" (
	"run_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"was_new" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"scoring_version" integer NOT NULL,
	"total" integer NOT NULL,
	"components" jsonb NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"contact_tier" "contact_tier" NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"niche" text NOT NULL,
	"city" text NOT NULL,
	"radius_km" integer,
	"provider" "provider" NOT NULL,
	"requested_count" integer DEFAULT 0 NOT NULL,
	"returned_count" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"units_spent" numeric(10, 4) DEFAULT '0' NOT NULL,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spend_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"units" numeric(12, 4) NOT NULL,
	"run_id" uuid,
	"business_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_e164" text,
	"root_domain" text,
	"reason" "suppression_reason" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment" ADD CONSTRAINT "enrichment_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_events" ADD CONSTRAINT "pipeline_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_results" ADD CONSTRAINT "run_results_run_id_search_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."search_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_results" ADD CONSTRAINT "run_results_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_run_id_search_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."search_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "briefs_one_per_business" ON "briefs" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_phone_uniq" ON "businesses" USING btree ("phone_e164") WHERE "businesses"."phone_e164" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_domain_uniq" ON "businesses" USING btree ("root_domain") WHERE "businesses"."root_domain" is not null;--> statement-breakpoint
CREATE INDEX "businesses_name_city_idx" ON "businesses" USING btree (lower("name"),lower("city"));--> statement-breakpoint
CREATE INDEX "pipeline_status_idx" ON "pipeline" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pipeline_next_action_idx" ON "pipeline" USING btree ("next_action_at");--> statement-breakpoint
CREATE INDEX "pipeline_events_business_idx" ON "pipeline_events" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_results_pk" ON "run_results" USING btree ("run_id","business_id");--> statement-breakpoint
CREATE INDEX "run_results_business_idx" ON "run_results" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scores_business_version_uniq" ON "scores" USING btree ("business_id","scoring_version");--> statement-breakpoint
CREATE INDEX "scores_total_idx" ON "scores" USING btree ("total");--> statement-breakpoint
CREATE INDEX "spend_ledger_provider_time_idx" ON "spend_ledger" USING btree ("provider","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_phone_uniq" ON "suppressions" USING btree ("phone_e164") WHERE "suppressions"."phone_e164" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_domain_uniq" ON "suppressions" USING btree ("root_domain") WHERE "suppressions"."root_domain" is not null;