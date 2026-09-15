/**
 * Builds the WhatsApp message. User-facing text is German; WhatsApp markup
 * uses *bold* and _italic_.
 */

import type { EventDetails, TicketOffer } from "./scraper.js";
import { formatGermanDate } from "./time.js";

const NUMBER_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"] as const;

const SIGNATURE = "_Automatische Nachricht vom FNC-Bot 🤖 – ich schaue alle 10 Minuten auf dd-munich.de._";

export function formatEuro(amount: number): string {
  return `${amount.toFixed(2).replace(".", ",")} €`;
}

function cheapestMatching(offers: readonly TicketOffer[], expectedPriceEur: number): TicketOffer | null {
  return offers.find((offer) => offer.priceEur === expectedPriceEur) ?? null;
}

function priceLine(event: EventDetails, expectedPriceEur: number): string {
  const match = cheapestMatching(event.offers, expectedPriceEur);
  if (match !== null) return formatEuro(match.priceEur);
  // Fallback for --ignore-price test runs.
  const first = event.offers[0];
  return first === undefined ? "Preis unbekannt" : formatEuro(first.priceEur);
}

export function buildMessage(
  events: readonly EventDetails[],
  isoDate: string,
  expectedPriceEur: number,
): string {
  const dateLabel = formatGermanDate(isoDate);

  if (events.length === 1) {
    const event = events[0];
    if (event === undefined) throw new Error("buildMessage called without events.");
    return [
      `🃏 *${event.title}* ist online!`,
      "",
      `📅 ${dateLabel} um ${event.startTime} Uhr`,
      `💶 ${priceLine(event, expectedPriceEur)}`,
      `🎟️ ${event.url}`,
      "",
      SIGNATURE,
    ].join("\n");
  }

  const lines: string[] = [
    `🃏 Für *${dateLabel}* sind *${events.length} Termine* online:`,
    "",
  ];

  events.forEach((event, index) => {
    lines.push(
      `${NUMBER_EMOJI[index] ?? `${index + 1}.`} *${event.title}*`,
      `📅 ${event.startTime} Uhr · 💶 ${priceLine(event, expectedPriceEur)}`,
      `🎟️ ${event.url}`,
      "",
    );
  });

  lines.push(SIGNATURE);
  return lines.join("\n");
}
