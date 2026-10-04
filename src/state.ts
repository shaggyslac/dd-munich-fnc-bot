/**
 * Remembers which Fridays have already been announced, so the ten-minute poll
 * posts exactly once per event date. The file is committed back to the
 * repository by the workflow — that commit doubles as the activity GitHub
 * requires to keep scheduled workflows enabled.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { StateStore } from "./core.js";

export interface PostedRecord {
  readonly postedAt: string;
  readonly events: readonly string[];
}

export type PostedState = Record<string, PostedRecord>;

export async function loadState(path: string): Promise<PostedState> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return {};
    throw error;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as PostedState;
  } catch {
    // A corrupted state file must not block an announcement.
    return {};
  }
}

export async function saveState(path: string, state: PostedState): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function hasBeenPosted(state: PostedState, isoDate: string): boolean {
  return Object.prototype.hasOwnProperty.call(state, isoDate);
}

/** File-backed state for the Node entry point. */
export class FileStateStore implements StateStore {
  constructor(private readonly path: string) {}

  async hasPosted(isoDate: string): Promise<boolean> {
    return hasBeenPosted(await loadState(this.path), isoDate);
  }

  async markPosted(isoDate: string, events: readonly string[]): Promise<void> {
    const state = await loadState(this.path);
    await saveState(this.path, {
      ...state,
      [isoDate]: { postedAt: new Date().toISOString(), events: [...events] },
    });
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}
