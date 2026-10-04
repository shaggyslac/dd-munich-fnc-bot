/**
 * One polling run, independent of where it is hosted: check whether
 * "Friday Night Commander" is online for the coming Friday at the expected
 * price, and announce it once in WhatsApp.
 */

import type { Config } from "./config.js";
import { buildMessage, formatEuro } from "./message.js";
import { fetchEventDetails, fetchEventList, type EventDetails, type EventListEntry } from "./scraper.js";
import { berlinTime, isWithinWatchWindow, upcomingFriday } from "./time.js";
import { sendGroupMessage } from "./whatsapp.js";

/** Where the "already announced" marker is kept — a file, or Cloudflare KV. */
export interface StateStore {
  hasPosted(isoDate: string): Promise<boolean>;
  markPosted(isoDate: string, events: readonly string[]): Promise<void>;
}

export type Outcome =
  | "outside-window"
  | "already-posted"
  | "not-listed"
  | "nothing-for-date"
  | "placeholder-price"
  | "dry-run"
  | "sent";

export interface CheckResult {
  readonly targetFriday: string;
  readonly outcome: Outcome;
  readonly message: string | null;
  readonly messageId: string | null;
  readonly log: readonly string[];
}

function normalise(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Matches the event by title prefix rather than by exact equality: the
 * organiser appends time suffixes to some events ("After Work Modern - 19:00
 * Uhr"), and the exact title is repeated in the message anyway.
 */
function matchesTitle(entry: EventListEntry, prefix: string): boolean {
  return normalise(entry.title).startsWith(normalise(prefix));
}

export async function runCheck(config: Config, store: StateStore): Promise<CheckResult> {
  const lines: string[] = [];
  const log = (message: string): void => {
    lines.push(message);
    console.log(`[${new Date().toISOString()}] ${message}`);
  };

  const now = berlinTime();
  const targetFriday =
    config.targetFridayOverride === "" ? upcomingFriday(now) : config.targetFridayOverride;
  const done = (outcome: Outcome, message: string | null = null, messageId: string | null = null): CheckResult => ({
    targetFriday,
    outcome,
    message,
    messageId,
    log: lines,
  });

  if (config.testMode) {
    log("TEST MODE — window and price are ignored, nothing is written to the live state.");
  }
  log(
    `Now (Berlin): ${now.isoDate} ${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")}` +
      ` — target Friday: ${targetFriday}`,
  );

  if (!isWithinWatchWindow(now) && !config.ignoreWindow) {
    log("Outside the watch window (Wed 00:00 – Fri 18:00). Nothing to do.");
    return done("outside-window");
  }

  if (!config.dryRun && (await store.hasPosted(targetFriday))) {
    log(`Already announced ${targetFriday}. Nothing to do.`);
    return done("already-posted");
  }

  const entries = await fetchEventList(config.eventListUrl);
  log(`Event list returned ${entries.length} events.`);

  const candidates = entries.filter((entry) => matchesTitle(entry, config.eventTitlePrefix));
  if (candidates.length === 0) {
    log(`No event matching "${config.eventTitlePrefix}" is listed yet.`);
    return done("not-listed");
  }
  log(`Matching by title: ${candidates.map((candidate) => candidate.title).join(", ")}`);

  // The slug already carries the date; the detail page confirms it and adds prices.
  const forTargetDate: EventDetails[] = [];
  for (const candidate of candidates) {
    if (candidate.isoDate !== null && candidate.isoDate !== targetFriday) {
      log(`Skipping "${candidate.title}" — listed for ${candidate.isoDate}, not ${targetFriday}.`);
      continue;
    }
    const details = await fetchEventDetails(candidate);
    if (details.isoDate !== targetFriday) {
      log(`Skipping "${details.title}" — starts ${details.isoDate}, not ${targetFriday}.`);
      continue;
    }
    const prices = details.offers.map((offer) => `${offer.name}: ${formatEuro(offer.priceEur)}`).join(", ");
    log(`Found "${details.title}" at ${details.startTime} — ${prices || "no prices listed"}`);
    forTargetDate.push(details);
  }

  if (forTargetDate.length === 0) {
    log(`Nothing listed for ${targetFriday} yet.`);
    return done("nothing-for-date");
  }

  const priced = config.ignorePrice
    ? forTargetDate
    : forTargetDate.filter((event) =>
        event.offers.some((offer) => offer.priceEur === config.expectedPriceEur),
      );

  if (priced.length === 0) {
    log(`Event is listed but not yet at ${formatEuro(config.expectedPriceEur)} — still a placeholder price. Waiting.`);
    return done("placeholder-price");
  }

  const message = buildMessage(priced, targetFriday, config.expectedPriceEur, config.testMode);

  if (config.dryRun) {
    log("DRY RUN — nothing sent.");
    return done("dry-run", message);
  }

  // Test runs must never reach the group.
  const chatId = config.testMode ? config.testChatId : config.groupChatId;
  if (chatId === "") {
    throw new Error("TEST_CHAT_ID is not set — refusing to send a test message to the group.");
  }

  const messageId = await sendGroupMessage(
    {
      baseUrl: config.greenApiBaseUrl,
      instanceId: config.greenApiInstanceId,
      token: config.greenApiToken,
    },
    chatId,
    message,
  );
  log(`Sent to WhatsApp (message id ${messageId}).`);

  if (config.testMode) {
    log("Test run — live state untouched.");
    return done("sent", message, messageId);
  }

  await store.markPosted(
    targetFriday,
    priced.map((event) => `${event.title} (${event.startTime})`),
  );
  log(`Recorded ${targetFriday} as announced.`);
  return done("sent", message, messageId);
}
