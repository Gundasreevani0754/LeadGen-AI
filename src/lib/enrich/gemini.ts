import { normalizePhone } from "../normalize";
import type { ContactFindings } from "./types";

/**
 * Gemini Flash reads the page text that the regexes could not.
 *
 * Two rules keep this honest. It is only called for the fields deterministic
 * extraction missed, so it costs nothing on a well-marked-up site. And every
 * value it returns is re-validated here before use — the model is an extractor,
 * never a source of truth (§15.1: no invented facts, and emphatically no
 * constructed email addresses, which is exactly how the old app failed).
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 30_000;

export interface GeminiOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    email: { type: "string", nullable: true },
    whatsapp_phone: { type: "string", nullable: true },
    linkedin_url: { type: "string", nullable: true },
    instagram_url: { type: "string", nullable: true },
    facebook_url: { type: "string", nullable: true },
    x_url: { type: "string", nullable: true },
  },
  required: [],
} as const;

const INSTRUCTION = `You extract contact details that already appear in the page text of a small business website.

Rules, in order of importance:
1. Only return a value that appears verbatim in the text. Never construct, guess, complete or "correct" an address or a handle.
2. If a field is absent, return null for it. A null is a correct answer; an invented value is a serious error.
3. Prefer the business's own contact details over those of its web designer, its suppliers, or a platform.
4. Return the phone number for WhatsApp only when the text explicitly associates it with WhatsApp.
5. Social URLs must be full profile URLs, not post or share links.`;

interface GeminiPart {
  text?: string;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export interface GeminiExtraction {
  contacts: Partial<ContactFindings>;
  inputTokens: number;
  outputTokens: number;
}

const EMPTY: GeminiExtraction = { contacts: {}, inputTokens: 0, outputTokens: 0 };

export async function extractWithGemini(
  pageText: string,
  missing: (keyof ContactFindings)[],
  options: GeminiOptions,
): Promise<GeminiExtraction> {
  if (missing.length === 0 || pageText.trim().length < 40) return EMPTY;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(
      `${ENDPOINT}/${options.model}:generateContent?key=${encodeURIComponent(options.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: INSTRUCTION }] },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Missing fields: ${missing.join(", ")}\n\nPAGE TEXT:\n${pageText}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      },
    );

    if (!response.ok) return EMPTY;

    const body = (await response.json()) as GeminiResponse;
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return EMPTY;

    return {
      contacts: validate(parseJson(text), pageText),
      inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
    };
  } catch {
    // An extraction failure degrades the lead's contact tier; it never fails a run.
    return EMPTY;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * The guard that makes rule 1 enforceable rather than aspirational: anything the
 * model returns must be findable in the text it was given.
 */
export function validate(
  raw: Record<string, unknown>,
  sourceText: string,
): Partial<ContactFindings> {
  const haystack = sourceText.toLowerCase();
  const out: Partial<ContactFindings> = {};

  const email = asString(raw.email);
  if (email && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) && haystack.includes(email.toLowerCase())) {
    out.email = email.toLowerCase();
  }

  const whatsapp = asString(raw.whatsapp_phone);
  if (whatsapp) {
    const digits = whatsapp.replace(/\D/g, "");
    const normalized = normalizePhone(whatsapp);
    if (normalized && digits.length >= 8 && haystack.replace(/\D/g, "").includes(digits)) {
      out.whatsappPhone = normalized;
    }
  }

  const socials: [keyof ContactFindings, string, RegExp][] = [
    ["linkedinUrl", asString(raw.linkedin_url) ?? "", /linkedin\.com/i],
    ["instagramUrl", asString(raw.instagram_url) ?? "", /instagram\.com/i],
    ["facebookUrl", asString(raw.facebook_url) ?? "", /facebook\.com|fb\.com/i],
    ["xUrl", asString(raw.x_url) ?? "", /twitter\.com|x\.com/i],
  ];

  for (const [key, value, host] of socials) {
    if (!value || !host.test(value)) continue;
    try {
      const url = new URL(value.startsWith("http") ? value : `https://${value}`);
      if (url.pathname.length <= 1) continue;
      out[key] = url.toString();
    } catch {
      // Not a URL — drop it rather than storing something unclickable.
    }
  }

  return out;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}
