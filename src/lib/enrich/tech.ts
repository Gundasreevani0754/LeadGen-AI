import type { FetchedPage, TechFindings } from "./types";

/**
 * Platform and capability fingerprinting.
 *
 * The gaps found here are the pitch (§10 — "Automation gap"), so the rule is
 * conservative in one direction only: a false *positive* on `hasBooking` costs
 * the operator a lead they would have pitched; a false negative costs them one
 * awkward sentence on a call. Patterns therefore need a real vendor fingerprint,
 * not a word on the page.
 */

interface Fingerprint {
  id: string;
  pattern: RegExp;
}

const PLATFORMS: Fingerprint[] = [
  { id: "wix", pattern: /wix\.com|wixstatic|_wixCssImports|X-Wix-/i },
  { id: "wordpress", pattern: /wp-content|wp-includes|wp-json|generator" content="WordPress/i },
  { id: "shopify", pattern: /cdn\.shopify\.com|Shopify\.theme|shopify-section/i },
  { id: "squarespace", pattern: /squarespace\.com|static1\.squarespace|Static\.SQUARESPACE/i },
  { id: "webflow", pattern: /webflow\.com|data-wf-page|wf-form/i },
  { id: "godaddy", pattern: /godaddysites\.com|img1\.wsimg\.com/i },
  { id: "weebly", pattern: /weebly\.com|weeblysite/i },
  { id: "framer", pattern: /framerusercontent|framer\.com\/m\//i },
  { id: "nextjs", pattern: /__NEXT_DATA__|\/_next\/static/i },
  { id: "react", pattern: /data-reactroot|react-dom|__REACT_DEVTOOLS/i },
  { id: "elementor", pattern: /elementor-(?:page|widget|frontend)/i },
  { id: "woocommerce", pattern: /woocommerce|wc-ajax/i },
];

const BOOKING: Fingerprint[] = [
  { id: "calendly", pattern: /calendly\.com/i },
  { id: "cal.com", pattern: /cal\.com\/embed|app\.cal\.com/i },
  { id: "acuity", pattern: /acuityscheduling\.com/i },
  { id: "setmore", pattern: /setmore\.com/i },
  { id: "simplybook", pattern: /simplybook\.(me|it)/i },
  { id: "zcal", pattern: /zcal\.co/i },
  { id: "practo", pattern: /practo\.com\/.*book|practo-book/i },
  { id: "opentable", pattern: /opentable\.(com|co\.uk)/i },
  { id: "bookingcom", pattern: /booking\.com\/hotel/i },
  { id: "square-appointments", pattern: /squareup\.com\/appointments|square\.site\/book/i },
  { id: "fresha", pattern: /fresha\.com/i },
  { id: "zenoti", pattern: /zenoti\.com/i },
  { id: "wix-bookings", pattern: /wix-bookings|bookings-viewer/i },
];

const CHAT: Fingerprint[] = [
  { id: "tawk", pattern: /tawk\.to/i },
  { id: "crisp", pattern: /crisp\.chat/i },
  { id: "intercom", pattern: /intercom\.io|intercomcdn/i },
  { id: "drift", pattern: /drift\.com|driftt\.com/i },
  { id: "tidio", pattern: /tidio\.co/i },
  { id: "zendesk-chat", pattern: /zopim|zendesk\.com\/embeddable/i },
  { id: "livechat", pattern: /livechatinc\.com/i },
  { id: "hubspot-chat", pattern: /js\.hs-scripts\.com|hubspot\.com\/conversations/i },
  { id: "freshchat", pattern: /freshchat|wchat\.freshchat\.com/i },
  { id: "whatsapp-widget", pattern: /whatsapp-widget|wa-widget|floating[-_]?whatsapp/i },
  { id: "messenger", pattern: /fb-customerchat|connect\.facebook\.net\/.*customerchat/i },
];

const PAYMENT: Fingerprint[] = [
  { id: "razorpay", pattern: /razorpay\.com|checkout\.razorpay/i },
  { id: "stripe", pattern: /js\.stripe\.com|checkout\.stripe\.com/i },
  { id: "paypal", pattern: /paypal\.com\/(sdk|checkoutnow)|paypalobjects/i },
  { id: "payu", pattern: /payu\.(in|com)|secure\.payu/i },
  { id: "cashfree", pattern: /cashfree\.com/i },
  { id: "instamojo", pattern: /instamojo\.com/i },
  { id: "phonepe", pattern: /phonepe\.com\/.*pay|mercury\.phonepe/i },
  { id: "paytm", pattern: /securegw\.paytm|paytm\.com\/.*checkout/i },
  { id: "square-checkout", pattern: /squareupsandbox|square\.link/i },
  { id: "woocommerce-checkout", pattern: /wc-ajax=checkout|woocommerce-checkout/i },
  { id: "shopify-checkout", pattern: /shopify\.com\/.*\/checkouts|cart\/checkout/i },
];

export interface TechInput {
  pages: FetchedPage[];
  /** A booking URL on the Google listing counts as booking even with no site. */
  listingBookingUrl?: string | null;
  /** True when the business has no crawlable website at all. */
  hasSite: boolean;
}

export function detectTech({
  pages,
  listingBookingUrl,
  hasSite,
}: TechInput): TechFindings {
  const haystack = pages.map((page) => page.html).join("\n");

  const platforms = matchIds(haystack, PLATFORMS);
  const booking = matchIds(haystack, BOOKING);
  const chat = matchIds(haystack, CHAT);
  const payment = matchIds(haystack, PAYMENT);

  const techStack = platforms.length > 0 ? platforms : hasSite ? ["custom"] : ["none"];

  return {
    techStack: [...techStack, ...booking, ...chat, ...payment],
    hasBooking: booking.length > 0 || Boolean(listingBookingUrl),
    hasChat: chat.length > 0,
    hasOnlinePayment: payment.length > 0,
  };
}

/** Platforms that mean "someone bought a template", which is its own gap signal. */
export const SITE_BUILDERS = new Set([
  "wix",
  "godaddy",
  "weebly",
  "squarespace",
  "business.site",
]);

export function isSiteBuilder(techStack: string[] | null | undefined): boolean {
  return (techStack ?? []).some((id) => SITE_BUILDERS.has(id));
}

function matchIds(haystack: string, fingerprints: Fingerprint[]): string[] {
  return fingerprints.filter((f) => f.pattern.test(haystack)).map((f) => f.id);
}
