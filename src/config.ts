/**
 * Runtime configuration. The source is `process.env` under Node and the
 * binding object under Cloudflare Workers, so it is always passed in.
 */

export type EnvSource = Readonly<Record<string, string | undefined>>;

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
  /** Chat that receives test messages, so tests never reach the group. */
  readonly testChatId: string;
  /** Skip the actual WhatsApp send and report the message instead. */
  readonly dryRun: boolean;
  /** Ignore the Wednesday-to-Friday watch window (for manual testing). */
  readonly ignoreWindow: boolean;
  /** Ignore the price condition (for manual testing). */
  readonly ignorePrice: boolean;
  /**
   * End-to-end test: really sends, but marks the message as a test, delivers it
   * to `testChatId` and keeps its own state, so the real announcement is not
   * suppressed.
   */
  readonly testMode: boolean;
  /** State file for the Node entry point, relative to the repository root. */
  readonly stateFile: string;
  /**
   * Checks this Friday instead of the coming one. Honoured only in test or dry
   * runs, so a live run can never be pointed at the wrong date.
   */
  readonly targetFridayOverride: string;
}

function readFlag(env: EnvSource, name: string): boolean {
  const raw = env[name];
  return raw === "true" || raw === "1";
}

function readRequired(env: EnvSource, name: string, optional: boolean): string {
  const raw = env[name];
  if (raw !== undefined && raw !== "") return raw;
  // A dry run never calls Green API, so missing credentials must not abort.
  if (optional) return "";
  throw new Error(`Environment variable ${name} is not set.`);
}

export function loadConfig(env: EnvSource): Config {
  const dryRun = readFlag(env, "DRY_RUN");
  const testMode = readFlag(env, "TEST_MODE");
  const priceRaw = env["EXPECTED_PRICE_EUR"];
  const expectedPriceEur = priceRaw === undefined || priceRaw === "" ? 14 : Number(priceRaw);

  if (!Number.isFinite(expectedPriceEur)) {
    throw new Error(`EXPECTED_PRICE_EUR is not a number: ${String(priceRaw)}`);
  }

  return {
    eventListUrl: env["EVENT_LIST_URL"] ?? "https://www.dd-munich.de/event-list",
    eventTitlePrefix: (env["EVENT_TITLE"] ?? "Friday Night Commander").toLowerCase(),
    expectedPriceEur,
    greenApiBaseUrl: env["GREENAPI_BASE_URL"] ?? "https://api.green-api.com",
    greenApiInstanceId: readRequired(env, "GREENAPI_ID_INSTANCE", dryRun),
    greenApiToken: readRequired(env, "GREENAPI_API_TOKEN", dryRun),
    groupChatId: readRequired(env, "WHATSAPP_GROUP_ID", dryRun),
    testChatId: env["TEST_CHAT_ID"] ?? "",
    dryRun,
    // A test has to run now and with whatever price is currently listed.
    ignoreWindow: testMode || readFlag(env, "IGNORE_WINDOW"),
    ignorePrice: testMode || readFlag(env, "IGNORE_PRICE"),
    testMode,
    stateFile: testMode ? "state/test-posted.json" : "state/posted.json",
    targetFridayOverride: testMode || dryRun ? (env["TARGET_FRIDAY"] ?? "") : "",
  };
}
