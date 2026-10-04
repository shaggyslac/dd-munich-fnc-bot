/**
 * Node entry point, used for local dry runs. The live checks run as a
 * Cloudflare Worker (src/worker.ts), because GitHub's scheduler skipped runs
 * for hours at a time.
 */

import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { runCheck } from "./core.js";
import { FileStateStore } from "./state.js";

const REPO_ROOT = new URL("../", import.meta.url);

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const statePath = fileURLToPath(new URL(config.stateFile, REPO_ROOT));
  const result = await runCheck(config, new FileStateStore(statePath));

  if (result.outcome === "dry-run" && result.message !== null) {
    console.log(`\n--- Nachricht ---\n${result.message}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
