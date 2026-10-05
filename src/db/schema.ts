import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schema for the LeadGen pipeline.
 *
 * The anti-waste rules (§7) are enforced here by constraints rather than by
 * application code, so no future code path can spend the same quota twice.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const businessStatusEnum = pgEnum("business_status", [
  "operational",
  "closed_temporarily",
  "closed_permanently",
]);

export const providerEnum = pgEnum("provider", ["serpapi", "apify"]);

export const runStatusEnum = pgEnum("run_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const crawlStatusEnum = pgEnum("crawl_status", [
  "ok",
  "blocked",
  "no_site",
  "failed",
]);

export const entityTypeEnum = pgEnum("entity_type", [
  "business",
  "service_provider",
]);

/** Which rung of the contact fallback ladder this lead reached (§9). */
export const contactTierEnum = pgEnum("contact_tier", [
  "phone",
  "email",
  "linkedin",
  "social",
  "form",
  "none",
]);

export const pipelineStatusEnum = pgEnum("pipeline_status", [
  "new",
  "qualified",
  "contacted",
  "replied",
  "call_booked",
  "won",
  "dead",
]);

export const suppressionReasonEnum = pgEnum("suppression_reason", [
  "dead",
  "do_not_contact",
  "bounced",
]);

// ---------------------------------------------------------------------------
// businesses — the canonical entity
// ---------------------------------------------------------------------------

export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),

    /**
     * Google's stable place identifier. The strongest dedupe key available —
     * it survives a business renaming itself or changing its phone number.
     */
    placeId: text("place_id"),

    phoneRaw: text("phone_raw"),
    /** E.164 normalized. Primary dedupe key. */
    phoneE164: text("phone_e164"),

    websiteUrl: text("website_url"),
    /** Registrable domain, lowercased, no www. Secondary dedupe key. */
    rootDomain: text("root_domain"),

    address: text("address"),
    city: text("city"),
    region: text("region"),
    /** Drives call (IN) vs WhatsApp (international) in the UI. */
    countryCode: text("country_code"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),

    googleRating: numeric("google_rating", { precision: 2, scale: 1 }),
    googleReviewCount: integer("google_review_count"),
    googleCategory: text("google_category"),
    googleMapsUrl: text("google_maps_url"),
    /**
     * Date of the newest review. Not available from Maps *search* results — it
     * needs a per-business reviews call, which is too expensive to run on every
     * lead. Backfilled only for high scorers. See spec §17.1.
     */
    newestReviewAt: timestamp("newest_review_at", { withTimezone: true }),

    /** Booking URL exposed by the listing. Seeds `enrichment.has_booking`. */
    bookOnlineUrl: text("book_online_url"),
    /**
     * The owner has never claimed their Google Business Profile — a strong
     * signal that nothing about their digital presence is being managed.
     */
    unclaimedListing: boolean("unclaimed_listing"),

    businessStatus: businessStatusEnum("business_status")
      .notNull()
      .default("operational"),

    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("businesses_place_id_uniq")
      .on(t.placeId)
      .where(sql`${t.placeId} is not null`),
    uniqueIndex("businesses_phone_uniq")
      .on(t.phoneE164)
      .where(sql`${t.phoneE164} is not null`),
    uniqueIndex("businesses_domain_uniq")
      .on(t.rootDomain)
      .where(sql`${t.rootDomain} is not null`),
    // Fallback matching for businesses with neither a phone nor a domain.
    index("businesses_name_city_idx").on(
      sql`lower(${t.name})`,
      sql`lower(${t.city})`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// search_runs / run_results — sourcing history, replayable
// ---------------------------------------------------------------------------

export const searchRuns = pgTable("search_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  niche: text("niche").notNull(),
  city: text("city").notNull(),
  radiusKm: integer("radius_km"),
  provider: providerEnum("provider").notNull(),

  requestedCount: integer("requested_count").notNull().default(0),
  returnedCount: integer("returned_count").notNull().default(0),
  newCount: integer("new_count").notNull().default(0),
  duplicateCount: integer("duplicate_count").notNull().default(0),
  /** Provider units consumed — searches for SerpApi, credits for Apify. */
  unitsSpent: numeric("units_spent", { precision: 10, scale: 4 })
    .notNull()
    .default("0"),

  status: runStatusEnum("status").notNull().default("pending"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const runResults = pgTable(
  "run_results",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => searchRuns.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    /** False when this run rediscovered a business we already had. */
    wasNew: boolean("was_new").notNull(),
  },
  (t) => [
    uniqueIndex("run_results_pk").on(t.runId, t.businessId),
    index("run_results_business_idx").on(t.businessId),
  ],
);

// ---------------------------------------------------------------------------
// enrichment — one row per business, TTL-gated (§7 rule 2)
// ---------------------------------------------------------------------------

export const enrichment = pgTable("enrichment", {
  businessId: uuid("business_id")
    .primaryKey()
    .references(() => businesses.id, { onDelete: "cascade" }),

  email: text("email"),
  whatsappPhone: text("whatsapp_phone"),
  linkedinUrl: text("linkedin_url"),
  instagramUrl: text("instagram_url"),
  facebookUrl: text("facebook_url"),
  xUrl: text("x_url"),
  contactFormUrl: text("contact_form_url"),

  techStack: text("tech_stack").array(),
  hasBooking: boolean("has_booking"),
  hasChat: boolean("has_chat"),
  hasOnlinePayment: boolean("has_online_payment"),

  domainRegisteredAt: date("domain_registered_at"),
  domainAgeYears: numeric("domain_age_years", { precision: 5, scale: 2 }),

  crawlStatus: crawlStatusEnum("crawl_status").notNull(),
  crawlError: text("crawl_error"),
  /** Compared against ENRICHMENT_TTL_DAYS to decide whether to re-crawl. */
  fetchedAt: timestamp("fetched_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// scores — versioned so a re-tune never destroys history (§14)
// ---------------------------------------------------------------------------

export const scores = pgTable(
  "scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    scoringVersion: integer("scoring_version").notNull(),

    total: integer("total").notNull(),
    /** Per-component breakdown, so the UI can explain why a lead scored what it did. */
    components: jsonb("components").notNull(),

    entityType: entityTypeEnum("entity_type").notNull(),
    contactTier: contactTierEnum("contact_tier").notNull(),

    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("scores_business_version_uniq").on(t.businessId, t.scoringVersion),
    index("scores_total_idx").on(t.total),
  ],
);

// ---------------------------------------------------------------------------
// briefs — one per business, enforced by index (§7 rule 3)
// ---------------------------------------------------------------------------

export const briefs = pgTable(
  "briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),

    painHypothesis: text("pain_hypothesis").notNull(),
    openingLine: text("opening_line").notNull(),
    auditMarkdown: text("audit_markdown").notNull(),

    model: text("model").notNull(),
    effort: text("effort").notNull(),
    sessionId: text("session_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),

    regeneratedCount: integer("regenerated_count").notNull().default(0),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // This index is the guarantee that Claude quota is never spent twice on one lead.
  (t) => [uniqueIndex("briefs_one_per_business").on(t.businessId)],
);

// ---------------------------------------------------------------------------
// pipeline — operator's working state
// ---------------------------------------------------------------------------

export const pipeline = pgTable(
  "pipeline",
  {
    businessId: uuid("business_id")
      .primaryKey()
      .references(() => businesses.id, { onDelete: "cascade" }),
    status: pipelineStatusEnum("status").notNull().default("new"),
    ownerNote: text("owner_note"),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("pipeline_status_idx").on(t.status),
    index("pipeline_next_action_idx").on(t.nextActionAt),
  ],
);

/** Append-only audit log. Joined against scores.components to re-tune weights. */
export const pipelineEvents = pgTable(
  "pipeline_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    fromStatus: pipelineStatusEnum("from_status"),
    toStatus: pipelineStatusEnum("to_status").notNull(),
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("pipeline_events_business_idx").on(t.businessId)],
);

// ---------------------------------------------------------------------------
// suppressions — checked at source time, before anything is written (§7)
// ---------------------------------------------------------------------------

export const suppressions = pgTable(
  "suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phoneE164: text("phone_e164"),
    rootDomain: text("root_domain"),
    reason: suppressionReasonEnum("reason").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("suppressions_phone_uniq")
      .on(t.phoneE164)
      .where(sql`${t.phoneE164} is not null`),
    uniqueIndex("suppressions_domain_uniq")
      .on(t.rootDomain)
      .where(sql`${t.rootDomain} is not null`),
  ],
);

// ---------------------------------------------------------------------------
// spend_ledger — powers the quota meters
// ---------------------------------------------------------------------------

export const spendLedger = pgTable(
  "spend_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** serpapi | apify | gemini | claude */
    provider: text("provider").notNull(),
    /** search | scrape | extract | brief */
    operation: text("operation").notNull(),
    units: numeric("units", { precision: 12, scale: 4 }).notNull(),

    runId: uuid("run_id").references(() => searchRuns.id, {
      onDelete: "set null",
    }),
    businessId: uuid("business_id").references(() => businesses.id, {
      onDelete: "set null",
    }),

    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("spend_ledger_provider_time_idx").on(t.provider, t.occurredAt)],
);

// ---------------------------------------------------------------------------
// app_settings — the values the operator can change without a redeploy
// ---------------------------------------------------------------------------

/**
 * One row, keyed `singleton` — every read and write targets that id, so the
 * table cannot accumulate competing configurations.
 *
 * `.env.local` remains the source of the *defaults*; this table is the override
 * the Settings page writes. Keeping tuning knobs in the database rather than in
 * environment variables means changing a threshold is a click, not a redeploy,
 * and the change is visible to the local workers immediately.
 */
export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey().default("singleton"),

  scoreThreshold: integer("score_threshold"),
  serviceProviderMaxRatio: numeric("service_provider_max_ratio", {
    precision: 3,
    scale: 2,
  }),
  enrichmentTtlDays: integer("enrichment_ttl_days"),

  claudeModel: text("claude_model"),
  claudeEffort: text("claude_effort"),
  claudeDailyBriefCap: integer("claude_daily_brief_cap"),

  /** Monthly provider allowances, used only to draw the quota meters. */
  serpapiMonthlyQuota: integer("serpapi_monthly_quota"),
  apifyMonthlyCredits: numeric("apify_monthly_credits", { precision: 8, scale: 2 }),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// legacy_* — the Flask app's data, quarantined
// ---------------------------------------------------------------------------

/**
 * The old app's searches and leads, preserved but deliberately kept out of the
 * pipeline.
 *
 * Phase 9 was specified as "import the legacy data so old companies immediately
 * participate in dedupe". Reading the data changed that: the Flask app asked
 * Gemini to *invent* leads and to construct email addresses from likely patterns
 * (spec §1). Companies like "Innovatech Solutions Pvt. Ltd." with
 * "priya.sharma@innovatech.com" do not exist.
 *
 * Letting those rows into `businesses` would break guardrail §15.1 — no invented
 * facts — and would seed dedupe with fabricated phones and domains, so a real
 * business could later be discarded as a duplicate of a hallucination. They live
 * here instead: nothing is lost, nothing is trusted, and no query in the
 * pipeline joins these tables.
 */
export const legacySearches = pgTable("legacy_searches", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The id this search had in the Flask SQLite database. */
  sourceId: text("source_id"),
  source: text("source").notNull(),

  offering: text("offering"),
  targetClient: text("target_client"),
  region: text("region"),
  leadCount: integer("lead_count"),

  searchedAt: timestamp("searched_at", { withTimezone: true }),
  importedAt: timestamp("imported_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const legacyLeads = pgTable(
  "legacy_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    searchId: uuid("search_id").references(() => legacySearches.id, {
      onDelete: "cascade",
    }),
    /** Which file or table this row came out of. */
    source: text("source").notNull(),

    companyName: text("company_name").notNull(),
    contactPerson: text("contact_person"),
    designation: text("designation"),
    contactEmail: text("contact_email"),
    contactLinkedinUrl: text("contact_linkedin_url"),
    companyLinkedinUrl: text("company_linkedin_url"),
    companyLocation: text("company_location"),
    companySize: text("company_size"),

    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Re-running the import must not duplicate rows.
  (t) => [
    uniqueIndex("legacy_leads_dedupe").on(t.source, t.companyName, t.contactEmail),
  ],
);
