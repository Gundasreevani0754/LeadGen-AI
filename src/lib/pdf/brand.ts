/**
 * Autotech's identity on the one-pager.
 *
 * This is the only file to edit when the branding is settled (spec §17.3 is
 * still open). Everything the prospect sees about *you* comes from here; every
 * other value on the page comes from the database.
 */

export const BRAND = {
  /** Wordmark at the top left. Keep it short — it is set large. */
  name: "AUTOTECH",
  /** One line under the wordmark. What you do, in the prospect's language. */
  tagline: "AI agents, automation and chatbots for local businesses",

  /** The contact block in the footer. Replace these with your real details. */
  operator: "Vamshi Krishna Emmadi",
  role: "Founder",
  phone: "+91 00000 00000",
  email: "hello@autotech.example",
  website: "autotech.example",

  /**
   * Taken from the dashboard's tokens so the artefact and the app read as one
   * thing. `accent` is reserved for the score and the gaps, exactly as on screen.
   */
  colors: {
    ink: "#1c1c22",
    inkMuted: "#5f6068",
    inkFaint: "#8b8c94",
    rule: "#e2e2e6",
    paper: "#ffffff",
    paperSunk: "#f6f5f3",
    accent: "#d1522a",
    accentSoft: "#fbeee8",
    good: "#3f7d52",
  },
} as const;

/** Set on every generated file so a prospect's name never leaks into a filename. */
export const PDF_METADATA = {
  author: BRAND.operator,
  creator: BRAND.name,
  producer: BRAND.name,
} as const;
