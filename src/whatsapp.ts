/**
 * WhatsApp delivery via Green API.
 *
 * Green API hosts the WhatsApp multi-device session, so nothing has to stay
 * online on our side: sending is a single HTTPS call. Messages are delivered
 * from the linked phone number.
 *
 * This is the only module that knows how messages are sent. Swapping the
 * provider (self-hosted Baileys, TextMeBot, …) means replacing this file.
 */

const REQUEST_TIMEOUT_MS = 20_000;

export interface GreenApiCredentials {
  readonly baseUrl: string;
  readonly instanceId: string;
  readonly token: string;
}

export interface ChatSummary {
  readonly id: string;
  readonly name: string | null;
}

function endpoint(credentials: GreenApiCredentials, method: string): string {
  const base = credentials.baseUrl.replace(/\/+$/, "");
  return `${base}/waInstance${credentials.instanceId}/${method}/${credentials.token}`;
}

async function callGreenApi(
  credentials: GreenApiCredentials,
  method: string,
  body?: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const response = await fetch(endpoint(credentials, method), {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  if (!response.ok) {
    // The token is part of the URL, so never surface the URL in errors.
    throw new Error(`Green API ${method} failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Green API ${method} returned invalid JSON: ${text.slice(0, 300)}`);
  }
}

/** Sends a text message and returns the provider-side message id. */
export async function sendGroupMessage(
  credentials: GreenApiCredentials,
  chatId: string,
  message: string,
): Promise<string> {
  const result = await callGreenApi(credentials, "sendMessage", { chatId, message });

  if (typeof result === "object" && result !== null && "idMessage" in result) {
    const id = (result as { idMessage: unknown }).idMessage;
    if (typeof id === "string") return id;
  }
  throw new Error(`Green API sendMessage returned no message id: ${JSON.stringify(result).slice(0, 300)}`);
}

/** Lists the chats the linked account can see — used to look up the group id. */
export async function listChats(credentials: GreenApiCredentials): Promise<ChatSummary[]> {
  const result = await callGreenApi(credentials, "getChats");
  if (!Array.isArray(result)) {
    throw new Error("Green API getChats did not return a list.");
  }

  const chats: ChatSummary[] = [];
  for (const item of result) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const id = record["id"];
    if (typeof id !== "string") continue;
    const name = record["name"];
    chats.push({ id, name: typeof name === "string" ? name : null });
  }
  return chats;
}
