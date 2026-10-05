import "server-only";

import { ApifySource } from "./apify";
import { SerpApiSource } from "./serpapi";
import type { LeadSource } from "./types";

const SOURCES: Record<LeadSource["name"], LeadSource> = {
  serpapi: new SerpApiSource(),
  apify: new ApifySource(),
};

export function getSource(name: LeadSource["name"]): LeadSource {
  return SOURCES[name];
}

export const SOURCE_NAMES = Object.keys(SOURCES) as LeadSource["name"][];

export * from "./types";
