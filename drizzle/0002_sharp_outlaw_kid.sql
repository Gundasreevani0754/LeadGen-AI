CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"score_threshold" integer,
	"service_provider_max_ratio" numeric(3, 2),
	"enrichment_ttl_days" integer,
	"claude_model" text,
	"claude_effort" text,
	"claude_daily_brief_cap" integer,
	"serpapi_monthly_quota" integer,
	"apify_monthly_credits" numeric(8, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
