/**
 * Scrapes the Wix event pages of dd-munich.de.
 *
 * The list page is server-rendered and exposes stable `data-hook` attributes;
 * the detail page carries a schema.org JSON-LD block with the ticket prices.
 * Neither needs a headless browser.
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 20_000;

export interface EventListEntry {
  readonly title: string;
  readonly url: string;
  /** Event date in Europe/Berlin, derived from the URL slug. */
  readonly isoDate: string | null;
}

export interface TicketOffer {
  readonly name: string;
  readonly priceEur: number;
}

export interface EventDetails {
  readonly title: string;
  readonly url: string;
  /** Event start date in Europe/Berlin, e.g. "2026-09-18". */
  readonly isoDate: string;
  /** Event start time in Europe/Berlin, e.g. "17:30". */
  readonly startTime: string;
  readonly offers: readonly TicketOffer[];
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  euro: "€",
};

function decodeHtml(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? match);
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, "accept-language": "de-DE,de;q=0.9" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  }
  return response.text();
}

/** Wix slugs end in "-YYYY-MM-DD-HH-MM" for dated occurrences. */
function isoDateFromSlug(url: string): string | null {
  const match = /-(\d{4})-(\d{2})-(\d{2})-\d{2}-\d{2}\/?$/.exec(url);
  if (match === null) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export async function fetchEventList(listUrl: string): Promise<EventListEntry[]> {
  const html = await fetchHtml(listUrl);
  const entries: EventListEntry[] = [];
  const seen = new Set<string>();

  const anchorPattern = /<a\b([^>]*\bdata-hook="title"[^>]*)>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(anchorPattern)) {
    const attributes = match[1] ?? "";
    const href = /\bhref="([^"]+)"/.exec(attributes)?.[1];
    if (href === undefined) continue;

    const url = new URL(decodeHtml(href), listUrl).toString();
    if (seen.has(url)) continue;
    seen.add(url);

    const title = decodeHtml((match[2] ?? "").replace(/<[^>]+>/g, "")).trim();
    entries.push({ title, url, isoDate: isoDateFromSlug(url) });
  }

  if (entries.length === 0) {
    throw new Error(
      `No events found on ${listUrl}. The page markup has probably changed.`,
    );
  }
  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  // Accepts "14", "14.00" and "14,00".
  const normalised = value.trim().replace(/\s/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Offers nest arbitrarily: a bare Offer, an array, or an AggregateOffer wrapping both. */
function collectOffers(value: unknown, into: TicketOffer[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectOffers(item, into);
    return;
  }
  if (!isRecord(value)) return;

  const priceEur = parsePrice(value["price"]);
  if (priceEur !== null) {
    const name = typeof value["name"] === "string" ? value["name"] : "Ticket";
    into.push({ name, priceEur });
  }
  if ("offers" in value) collectOffers(value["offers"], into);
}

function findEventNode(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findEventNode(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;

  const type = value["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === "string" && t.endsWith("Event"))) return value;

  if ("@graph" in value) return findEventNode(value["@graph"]);
  return null;
}

function berlinDateParts(startDate: string): { isoDate: string; startTime: string } {
  const date = new Date(startDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Unparseable startDate: ${startDate}`);
  }
  const formatter = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  return {
    isoDate: `${get("year")}-${get("month")}-${get("day")}`,
    startTime: `${String(Number(get("hour")) % 24).padStart(2, "0")}:${get("minute")}`,
  };
}

export async function fetchEventDetails(entry: EventListEntry): Promise<EventDetails> {
  const html = await fetchHtml(entry.url);

  const scriptPattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1] ?? "");
    } catch {
      continue; // Wix ships unrelated, occasionally malformed blocks too.
    }

    const event = findEventNode(parsed);
    if (event === null) continue;

    const startDate = event["startDate"];
    if (typeof startDate !== "string") continue;

    const offers: TicketOffer[] = [];
    collectOffers(event["offers"], offers);

    const { isoDate, startTime } = berlinDateParts(startDate);
    const title = typeof event["name"] === "string" ? event["name"] : entry.title;

    return { title, url: entry.url, isoDate, startTime, offers };
  }

  throw new Error(`No JSON-LD event data found on ${entry.url}`);
}
