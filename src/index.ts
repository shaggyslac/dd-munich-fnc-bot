/**
 * One polling run: check whether "Friday Night Commander" is online for the
 * coming Friday at the expected price, and announce it once in WhatsApp.
 */

import { loadConfig } from "./config.js";
import { buildMessage, formatEuro } from "./message.js";
import { fetchEventDetails, fetchEventList, type EventDetails, type EventListEntry } from "./scraper.js";
import { hasBeenPosted, loadState, saveState } from "./state.js";
import { berlinTime, isWithinWatchWindow, upcomingFriday } from "./time.js";
import { sendGroupMessage } from "./whatsapp.js";

const STATE_PATH = new URL("../state/posted.json", import.meta.url).pathname;

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
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

async function main(): Promise<void> {
  const config = loadConfig();
  const now = berlinTime();
  const targetFriday = upcomingFriday(now);

  log(`Now (Berlin): ${now.isoDate} ${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")} — target Friday: ${targetFriday}`);

  if (!isWithinWatchWindow(now) && !config.ignoreWindow) {
    log("Outside the watch window (Wed 00:00 – Fri 18:00). Nothing to do.");
    return;
  }

  const state = await loadState(STATE_PATH);
  if (hasBeenPosted(state, targetFriday) && !config.dryRun) {
    log(`Already announced ${targetFriday}. Nothing to do.`);
    return;
  }

  const entries = await fetchEventList(config.eventListUrl);
  log(`Event list returned ${entries.length} events.`);

  const candidates = entries.filter((entry) => matchesTitle(entry, config.eventTitlePrefix));
  if (candidates.length === 0) {
    log(`No event matching "${config.eventTitlePrefix}" is listed yet.`);
    return;
  }
  log(`Matching by title: ${candidates.map((c) => c.title).join(", ")}`);

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
    return;
  }

  const priced = config.ignorePrice
    ? forTargetDate
    : forTargetDate.filter((event) =>
        event.offers.some((offer) => offer.priceEur === config.expectedPriceEur),
      );

  if (priced.length === 0) {
    log(
      `Event is listed but not yet at ${formatEuro(config.expectedPriceEur)} — still a placeholder price. Waiting.`,
    );
    return;
  }

  const message = buildMessage(priced, targetFriday, config.expectedPriceEur);

  if (config.dryRun) {
    log("DRY RUN — message that would be sent:\n");
    console.log(message);
    return;
  }

  const messageId = await sendGroupMessage(
    {
      baseUrl: config.greenApiBaseUrl,
      instanceId: config.greenApiInstanceId,
      token: config.greenApiToken,
    },
    config.groupChatId,
    message,
  );
  log(`Sent to WhatsApp (message id ${messageId}).`);

  await saveState(STATE_PATH, {
    ...state,
    [targetFriday]: {
      postedAt: new Date().toISOString(),
      events: priced.map((event) => `${event.title} (${event.startTime})`),
    },
  });
  log(`Recorded ${targetFriday} as announced.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
