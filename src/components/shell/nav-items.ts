/** The seven surfaces from the design spec §12. Order matches daily workflow. */
export const NAV_ITEMS = [
  { href: "/", label: "Overview", hint: "Today's queue and quota" },
  { href: "/generator", label: "Generator", hint: "Source a new niche" },
  { href: "/leads", label: "Leads", hint: "Everything scored" },
  { href: "/pipeline", label: "Pipeline", hint: "Who you're talking to" },
  { href: "/history", label: "History", hint: "Past runs and cost" },
  { href: "/settings", label: "Settings", hint: "Thresholds and models" },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
