/**
 * All scheduling decisions are made in Europe/Berlin, independent of the
 * runner's own timezone (GitHub Actions runs in UTC).
 */

const TIMEZONE = "Europe/Berlin";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Friday, as used by Date.getUTCDay() and our weekday index. */
const FRIDAY = 5;

/** The watch window closes on Friday at this hour (Berlin local time). */
const FRIDAY_CUTOFF_HOUR = 18;

export interface BerlinTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** 0 = Sunday … 6 = Saturday */
  readonly weekday: number;
  /** ISO date, e.g. "2026-09-18" */
  readonly isoDate: string;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const found = parts.find((p) => p.type === type);
  if (found === undefined) throw new Error(`Missing date part: ${type}`);
  return found.value;
}

export function berlinTime(now: Date = new Date()): BerlinTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);

  const year = Number(part(parts, "year"));
  const month = Number(part(parts, "month"));
  const day = Number(part(parts, "day"));
  // Intl renders midnight as "24" in some ICU versions.
  const hour = Number(part(parts, "hour")) % 24;
  const minute = Number(part(parts, "minute"));
  const weekdayName = part(parts, "weekday");
  const weekday = WEEKDAYS.findIndex((w) => w === weekdayName);

  if (weekday < 0) throw new Error(`Unexpected weekday: ${weekdayName}`);

  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday,
    isoDate: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

/**
 * The Friday this run is about: the coming Friday, or today when it already is
 * Friday. Date arithmetic runs on a UTC noon anchor so DST shifts cannot move
 * the result onto a neighbouring day.
 */
export function upcomingFriday(time: BerlinTime): string {
  const anchor = new Date(Date.UTC(time.year, time.month - 1, time.day, 12));
  const daysUntilFriday = (FRIDAY - time.weekday + 7) % 7;
  anchor.setUTCDate(anchor.getUTCDate() + daysUntilFriday);
  return anchor.toISOString().slice(0, 10);
}

/**
 * The bot watches from Wednesday 00:00 until Friday 18:00 (Berlin).
 */
export function isWithinWatchWindow(time: BerlinTime): boolean {
  if (time.weekday === 3 || time.weekday === 4) return true; // Wednesday, Thursday
  if (time.weekday === FRIDAY) return time.hour < FRIDAY_CUTOFF_HOUR;
  return false;
}

/** "2026-09-18" -> "Freitag, 18.09.2026" */
export function formatGermanDate(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: TIMEZONE,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}
