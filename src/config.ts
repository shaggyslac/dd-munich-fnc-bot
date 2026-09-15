/** Runtime configuration, read from environment variables. */

export interface Config {
  /** Wix event list page that is scraped for the event. */
  readonly eventListUrl: string;
  /** Event title to watch for, normalised to lowercase. */
  readonly eventTitlePrefix: string;
  /** Ticket price in EUR that marks the event as finalised (dummy price is 140). */
  readonly expectedPriceEur: number;
  /** Green API base URL, as shown in the Green API console. */
  readonly greenApiBaseUrl: string;
  /** Green API instance id. */
  readonly greenApiInstanceId: string;
  /** Green API instance token. */
  readonly greenApiToken: string;
  /** WhatsApp group chat id, e.g. "120363012345678901@g.us". */
  readonly groupChatId: string;
  /** Skip the actual WhatsApp send and log the message instead. */
  readonly dryRun: boolean;
  /** Ignore the Wednesday-to-Friday watch window (for manual testing). */
  readonly ignoreWindow: boolean;
  /** Ignore the price condition (for manual testing). */
  readonly ignorePrice: boolean;
  /**
   * End-to-end test: really sends, but marks the message as a test and keeps
   * its own state file, so the real announcement is not suppressed.
   */
  readonly testMode: boolean;
  /** State file, relative to the repository root. */
  readonly stateFile: string;
}

function readFlag(name: string): boolean {
  const raw = process.env[name];
  return raw === "true" || raw === "1";
}

function readRequired(name: string, dryRun: boolean): string {
  const raw = process.env[name];
  if (raw !== undefined && raw !== "") return raw;
  // In a dry run we never call Green API, so missing credentials must not abort.
  if (dryRun) return "";
  throw new Error(`Environment variable ${name} is not set.`);
}

export function loadConfig(): Config {
  const dryRun = readFlag("DRY_RUN");
  const testMode = readFlag("TEST_MODE");
  const priceRaw = process.env["EXPECTED_PRICE_EUR"];
  const expectedPriceEur = priceRaw === undefined || priceRaw === "" ? 14 : Number(priceRaw);

  if (!Number.isFinite(expectedPriceEur)) {
    throw new Error(`EXPECTED_PRICE_EUR is not a number: ${String(priceRaw)}`);
  }

  return {
    eventListUrl: process.env["EVENT_LIST_URL"] ?? "https://www.dd-munich.de/event-list",
    eventTitlePrefix: (process.env["EVENT_TITLE"] ?? "Friday Night Commander").toLowerCase(),
    expectedPriceEur,
    greenApiBaseUrl: process.env["GREENAPI_BASE_URL"] ?? "https://api.green-api.com",
    greenApiInstanceId: readRequired("GREENAPI_ID_INSTANCE", dryRun),
    greenApiToken: readRequired("GREENAPI_API_TOKEN", dryRun),
    groupChatId: readRequired("WHATSAPP_GROUP_ID", dryRun),
    dryRun,
    // A test has to run now and with whatever price is currently listed.
    ignoreWindow: testMode || readFlag("IGNORE_WINDOW"),
    ignorePrice: testMode || readFlag("IGNORE_PRICE"),
    testMode,
    stateFile: testMode ? "state/test-posted.json" : "state/posted.json",
  };
}
