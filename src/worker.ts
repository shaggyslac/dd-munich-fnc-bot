/**
 * Cloudflare Worker entry point.
 *
 * The cron trigger drives the live checks. The HTTP handler exists only for
 * manual inspection and testing and is guarded by a shared token.
 */

import { loadConfig, type EnvSource } from "./config.js";
import { runCheck, type StateStore } from "./core.js";

export interface Env {
  readonly STATE: KVNamespace;
  readonly WORKER_TEST_TOKEN?: string;
}

const STATE_PREFIX = "posted:";

class KvStateStore implements StateStore {
  constructor(private readonly kv: KVNamespace) {}

  async hasPosted(isoDate: string): Promise<boolean> {
    return (await this.kv.get(`${STATE_PREFIX}${isoDate}`)) !== null;
  }

  async markPosted(isoDate: string, events: readonly string[]): Promise<void> {
    await this.kv.put(
      `${STATE_PREFIX}${isoDate}`,
      JSON.stringify({ postedAt: new Date().toISOString(), events }),
    );
  }
}

function envFor(env: Env, overrides: Readonly<Record<string, string>>): EnvSource {
  return { ...(env as unknown as Record<string, string | undefined>), ...overrides };
}

/** Length-independent comparison, so the token cannot be guessed byte by byte. */
function tokenMatches(expected: string | undefined, given: string | null): boolean {
  if (expected === undefined || expected === "" || given === null) return false;
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(given);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    diff |= (a[i % a.length] ?? 0) ^ (b[i % b.length] ?? 0);
  }
  return diff === 0;
}

async function describeState(env: Env): Promise<string> {
  const listed = await env.STATE.list({ prefix: STATE_PREFIX });
  if (listed.keys.length === 0) return "Noch keine Meldung gespeichert.";

  const rows: string[] = [];
  for (const key of listed.keys) {
    rows.push(`${key.name.slice(STATE_PREFIX.length)}  ${(await env.STATE.get(key.name)) ?? ""}`);
  }
  return rows.sort().join("\n");
}

export default {
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    try {
      await runCheck(loadConfig(envFor(env, {})), new KvStateStore(env.STATE));
    } catch (error: unknown) {
      // Logged for `wrangler tail`; throwing would only retry the whole cron.
      console.error("Check failed:", error instanceof Error ? error.message : String(error));
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!tokenMatches(env.WORKER_TEST_TOKEN, url.searchParams.get("token"))) {
      return new Response("Not found", { status: 404 });
    }

    const mode = url.searchParams.get("mode") ?? "dry";
    const text = (body: string): Response =>
      new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });

    try {
      if (mode === "status") return text(await describeState(env));

      const overrides =
        mode === "test"
          ? { TEST_MODE: "true" }
          : { DRY_RUN: "true", IGNORE_WINDOW: "true" };

      const result = await runCheck(loadConfig(envFor(env, overrides)), new KvStateStore(env.STATE));
      return text(
        [
          ...result.log,
          "",
          result.message === null ? "(keine Nachricht)" : `--- Nachricht ---\n${result.message}`,
        ].join("\n"),
      );
    } catch (error: unknown) {
      return text(`Fehler: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};
