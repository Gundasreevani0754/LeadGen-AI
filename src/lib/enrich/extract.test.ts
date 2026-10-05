import { describe, expect, test } from "vitest";

import {
  htmlToText,
  isComplete,
  pickContactForm,
  pickEmail,
  pickWhatsApp,
  extractContacts,
} from "./extract";
import { emptyContacts, type FetchedPage } from "./types";

const page = (html: string, url = "https://clinic.example/"): FetchedPage => ({
  url,
  html,
  status: 200,
});

describe("pickEmail", () => {
  test("prefers a mailto link over free text", () => {
    const html = `<a href="mailto:hello@clinic.example">Write to us</a> or noise@other.example`;
    expect(pickEmail(html, ["mailto:hello@clinic.example"])).toBe("hello@clinic.example");
  });

  test("falls back to an address in the page text", () => {
    const html = `<p>Reach us at Front.Desk@Clinic.example any time.</p>`;
    expect(pickEmail(html, [])).toBe("front.desk@clinic.example");
  });

  test("ignores addresses that belong to the toolchain", () => {
    const html = `<p>a@sentry.io</p><p>logo@example.com</p>`;
    expect(pickEmail(html, [])).toBeNull();
  });

  test("ignores addresses inside scripts, where tracking ids live", () => {
    const html = `<script>var id = "tag@wixpress.com";</script>`;
    expect(pickEmail(html, [])).toBeNull();
  });
});

describe("pickWhatsApp", () => {
  test("reads a wa.me link and normalizes it", () => {
    expect(pickWhatsApp("", ["https://wa.me/919876543210"])).toBe("+919876543210");
  });

  test("reads the api.whatsapp.com form", () => {
    const href = "https://api.whatsapp.com/send?phone=919876543210&text=hi";
    expect(pickWhatsApp("", [href])).toBe("+919876543210");
  });

  test("returns null when no whatsapp link exists", () => {
    expect(pickWhatsApp("<p>call us</p>", ["https://facebook.com/x"])).toBeNull();
  });
});

describe("pickContactForm", () => {
  test("accepts a form with an email field", () => {
    const html = `<form><input type="email" name="email"><button>Send</button></form>`;
    expect(pickContactForm(page(html))).toBe("https://clinic.example/");
  });

  test("rejects a search box", () => {
    const html = `<form><input type="search" name="s"></form>`;
    expect(pickContactForm(page(html))).toBeNull();
  });

  test("accepts a form with a textarea", () => {
    const html = `<form><textarea name="msg"></textarea></form>`;
    expect(pickContactForm(page(html))).toBe("https://clinic.example/");
  });
});

describe("extractContacts", () => {
  test("collects socials and skips share and post links", () => {
    const html = `
      <a href="https://www.instagram.com/p/abc123/">a post</a>
      <a href="https://www.instagram.com/smileclinic">our instagram</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
      <a href="https://www.facebook.com/smileclinic">facebook</a>
    `;
    const found = extractContacts([page(html)]);

    expect(found.instagramUrl).toBe("https://www.instagram.com/smileclinic");
    expect(found.facebookUrl).toBe("https://www.facebook.com/smileclinic");
  });

  test("merges findings across several pages", () => {
    const home = page(`<a href="https://www.instagram.com/smileclinic">ig</a>`);
    const contact = page(
      `<a href="mailto:hi@clinic.example">mail</a>`,
      "https://clinic.example/contact",
    );

    const found = extractContacts([home, contact]);
    expect(found.instagramUrl).toContain("instagram.com/smileclinic");
    expect(found.email).toBe("hi@clinic.example");
  });
});

describe("htmlToText", () => {
  test("drops scripts and styles and collapses whitespace", () => {
    const html = `<style>.a{color:red}</style><script>x()</script><h1>Smile</h1>
      <p>Open   daily</p>`;
    const text = htmlToText(html);

    expect(text).not.toContain("color:red");
    expect(text).not.toContain("x()");
    expect(text).toContain("Smile");
    expect(text).toContain("Open daily");
  });

  test("truncates to the character budget", () => {
    expect(htmlToText("<p>" + "a".repeat(500) + "</p>", 100)).toHaveLength(100);
  });
});

describe("isComplete", () => {
  test("is false until every channel is found", () => {
    expect(isComplete(emptyContacts())).toBe(false);
  });

  test("is true when email, whatsapp, a social and a form all exist", () => {
    expect(
      isComplete({
        ...emptyContacts(),
        email: "a@b.example",
        whatsappPhone: "+919876543210",
        instagramUrl: "https://instagram.com/x",
        contactFormUrl: "https://b.example/contact",
      }),
    ).toBe(true);
  });
});
