import type { NextConfig } from "next";

/**
 * A Content Security Policy tight enough to matter without a nonce pipeline.
 *
 * `'unsafe-inline'` on scripts is what Next's hydration bootstrap needs, and
 * removing it means threading a per-request nonce through the root layout —
 * worth doing for a public app taking user input. This one is single-operator,
 * renders no third-party content, and accepts no input from anyone else, so the
 * honest trade is to keep the directives that do real work here: no framing, no
 * plugins, no form posts to other origins, and a fixed list of places the app
 * may talk to.
 */
const isDev = process.env.NODE_ENV === "development";

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https:",
  // `ws:` is for Next's hot-reload socket, which only exists in development.
  // Shipping it to production would widen the policy for no reason.
  `connect-src 'self' https://*.supabase.co${isDev ? " ws: wss:" : ""}`,
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  /**
   * @react-pdf/renderer loads font metrics and hyphenation data through
   * conditional requires at runtime. Bundling it breaks that badly enough that
   * `renderToBuffer` never returns, so it is left external and required from
   * node_modules like an ordinary Node package.
   */
  serverExternalPackages: ["@react-pdf/renderer"],

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
