/**
 * Multi-root JSON persistence for state that MUST survive sandbox restarts.
 *
 * Why more than one location (sandbox default):
 *
 *  1. `<project>/.data/…`            — the primary, in-project store.
 *  2. `/tmp/my-project/.data/…`      — the sandbox's own session-snapshot
 *     store. A container boot re-materializes /home/z/my-project from here,
 *     which used to wipe hours of hunt state; keeping this copy FRESH means
 *     the boot's restore now delivers the live state instead of a stale one.
 *  3. `/home/z/.local/share/oci-hunter/…` — a home-directory backup that
 *     survives reboots even if /tmp semantics ever change.
 *
 * Deployments override this: set `HUNTER_DATA_DIR` for a single isolated
 * root (used by Render / Docker), and on Render (RENDER env) the mirrors
 * are skipped automatically. See PERSIST_ROOTS below.
 *
 * Restore strategy: read every copy, pick the NEWEST one (by the JSON's own
 * savedAt when present, else file mtime). Writes are atomic (tmp + rename)
 * and best-effort per root — one unwritable mirror must never break a hunt.
 */
import fs from "node:fs";
import path from "node:path";

const PROJECT_DATA_DIR = path.join(process.cwd(), ".data");

/**
 * PERSIST ROOTS
 *
 * - `HUNTER_DATA_DIR` env → that single directory is the ONLY root. Deployments
 *   (e.g. Render) and test rigs use this to get a fully isolated, predictable
 *   state store instead of the sandbox's multi-root mirrors.
 * - On Render (RENDER env var) the sandbox mirrors are pointless — the disk is
 *   ephemeral anyway — so only the in-project `.data` dir is used.
 * - Everywhere else the three sandbox-proof roots below apply unchanged.
 */
export const PERSIST_ROOTS: string[] = (() => {
  const envDir = process.env.HUNTER_DATA_DIR?.trim();
  if (envDir) return [path.resolve(envDir)];
  if (process.env.RENDER) return [PROJECT_DATA_DIR];
  return [PROJECT_DATA_DIR, "/tmp/my-project/.data", "/home/z/.local/share/oci-hunter"];
})();

export interface PersistedCopy<T> {
  parsed: T | null;
  source: string;
  savedAt: number; // epoch ms — JSON savedAt when available, else file mtime
}

function readCopy<T>(filePath: string): PersistedCopy<T> | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as T & { savedAt?: string | number };
    let savedAt = Number(new Date(0)); // absent → treat as oldest, refined below
    const s = parsed?.savedAt;
    if (typeof s === "number") savedAt = s;
    else if (typeof s === "string") {
      const t = Date.parse(s);
      if (!Number.isNaN(t)) savedAt = t;
    }
    if (savedAt === 0) savedAt = fs.statSync(filePath).mtimeMs;
    return { parsed, source: filePath, savedAt };
  } catch {
    return null; // missing or corrupt — ignore this copy
  }
}

/**
 * Return the newest parseable copy of `<filename>` across all roots.
 * `filename` is a single path segment like "hunter-state.json".
 */
export function readNewestJson<T>(filename: string): PersistedCopy<T> | null {
  let best: PersistedCopy<T> | null = null;
  for (const root of PERSIST_ROOTS) {
    const copy = readCopy<T>(path.join(root, filename));
    if (copy && (!best || copy.savedAt > best.savedAt)) best = copy;
  }
  return best;
}

/** True when a copy exists in any root (used to skip pointless reads). */
export function jsonExistsAnywhere(filename: string): boolean {
  return PERSIST_ROOTS.some((root) => fs.existsSync(path.join(root, filename)));
}

/** Absolute path of the primary copy of `<filename>` (PERSIST_ROOTS[0]). */
export function primaryPathFor(filename: string): string {
  return path.join(PERSIST_ROOTS[0], filename);
}

function atomicWrite(filePath: string, text: string) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now() % 100000}`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * Persist `data` as JSON to every root. The primary root (PERSIST_ROOTS[0] —
 * the project `.data` dir, or the HUNTER_DATA_DIR override) is written first
 * and its failure IS reported (caller may alert); every mirror is
 * best-effort and never throws.
 */
export function persistJsonEverywhere(filename: string, data: unknown): void {
  const text = JSON.stringify(data);
  const [primary, ...mirrors] = PERSIST_ROOTS;
  // 1) primary — must never silently fail
  fs.mkdirSync(primary, { recursive: true });
  atomicWrite(path.join(primary, filename), text);
  // 2) mirrors — best effort
  for (const root of mirrors) {
    try {
      fs.mkdirSync(root, { recursive: true });
      atomicWrite(path.join(root, filename), text);
    } catch (e) {
      console.warn(`[persist] mirror write failed (${root}):`, e instanceof Error ? e.message : e);
    }
  }
}
