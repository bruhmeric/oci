/**
 * Hunt job store — in-memory (survives HMR via globalThis) with
 * debounced persistence that mirrors to snapshot-proof locations (see
 * src/lib/persist.ts), so hunt state — including the stored API key and
 * SSH keys — survives not just dev-server restarts but full sandbox
 * session rollovers that reset the project directory from a snapshot.
 */
import crypto from "node:crypto";
import { persistJsonEverywhere, readNewestJson, primaryPathFor } from "@/lib/persist";
import type { HuntConfig, HuntJob, LogEntry, LogLevel } from "./types";
import type { SshKeyPair } from "./ssh";
import type { OciCredentials } from "@/lib/oci/client";

const STATE_FILENAME = "hunter-state.json";

const MAX_LOGS = 900;
const MAX_JOBS_KEPT = 25;

function nowIso() {
  return new Date().toISOString();
}

class HunterStore {
  private jobs = new Map<string, HuntJob>();
  private keys = new Map<string, SshKeyPair>();
  private saveTimer: NodeJS.Timeout | null = null;
  private restored = false;

  constructor() {
    this.restore();
  }

  /* ------------------------------ jobs ------------------------------ */

  createJob(config: HuntConfig): HuntJob {
    const id = crypto.randomUUID().slice(0, 8);
    const stamp = new Date();
    const job: HuntJob = {
      id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "starting",
      config,
      slots: Array.from({ length: config.instanceCount }, (_, i) => ({
        index: i,
        displayName: `${config.namePrefix}-${String(i + 1).padStart(2, "0")}`,
        status: "queued" as const,
        attempts: 0,
      })),
      logs: [],
      stats: { totalAttempts: 0, capacityMisses: 0, startedAt: nowIso() },
      stopRequested: false,
    };
    this.jobs.set(id, job);
    this.log(id, "info", `Hunt #${id} created — ${config.instanceCount} × VM.Standard.A1.Flex (${config.ocpus} OCPU / ${config.memoryInGBs} GB) in ${config.credentials.region}`);
    return job;
  }

  getJob(id: string): HuntJob | undefined {
    return this.jobs.get(id);
  }

  listJobs(): HuntJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get activeJob(): HuntJob | undefined {
    return this.listJobs().find((j) => j.status === "starting" || j.status === "running");
  }

  markUpdated(job: HuntJob) {
    job.updatedAt = nowIso();
    this.scheduleSave();
  }

  /* ------------------------------ logs ------------------------------ */

  log(jobId: string, level: LogLevel, message: string, slot?: number) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const entry: LogEntry = { ts: nowIso(), level, message, slot };
    job.logs.push(entry);
    if (job.logs.length > MAX_LOGS) job.logs.splice(0, job.logs.length - MAX_LOGS);
    this.markUpdated(job);
  }

  /* ------------------------------- keys ----------------------------- */

  saveKeyPair(pair: SshKeyPair) {
    this.keys.set(pair.keyId, pair);
    this.scheduleSave();
  }

  getKeyPair(keyId: string): SshKeyPair | undefined {
    return this.keys.get(keyId);
  }

  /** Find the newest hunt that still has a stored API private key. */
  latestJobWithStoredKey(): HuntJob | undefined {
    return this.listJobs().find((j) => !!j.config.credentials?.privateKeyPem);
  }

  /**
   * Resolve credentials for a request whose private key may live server-side
   * (restored from a previous hunt) instead of in the browser. A pasted PEM
   * always wins; otherwise the stored key is used only when the identity
   * fields (tenancy / user / fingerprint / region) match the saved hunt exactly,
   * so a stale key can never silently sign for different credentials.
   */
  reuseStoredPrivateKey(
    reuseFrom: string | null | undefined,
    supplied: { tenancyOcid: string; userOcid: string; fingerprint: string; region: string; privateKeyPem: string }
  ): { ok: boolean; credentials?: OciCredentials; message?: string } {
    if (supplied.privateKeyPem && supplied.privateKeyPem.trim().length > 50) {
      return { ok: true, credentials: supplied as OciCredentials };
    }
    if (!reuseFrom) {
      return { ok: false, message: "Private key (with BEGIN/END lines) is missing — paste it, or reuse the one stored server-side from your last hunt." };
    }
    const job = this.jobs.get(reuseFrom);
    if (!job) {
      return { ok: false, message: `Saved hunt #${reuseFrom} was not found — paste the private key instead.` };
    }
    const saved = job.config.credentials;
    const norm = (s: string) => s.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
    const matches =
      saved.tenancyOcid === supplied.tenancyOcid &&
      saved.userOcid === supplied.userOcid &&
      norm(saved.fingerprint) === norm(supplied.fingerprint) &&
      saved.region === supplied.region;
    if (!matches) {
      return { ok: false, message: `These credentials don't match hunt #${reuseFrom} — paste the private key that goes with them.` };
    }
    if (!saved.privateKeyPem) {
      return { ok: false, message: `Hunt #${reuseFrom} has no stored private key — paste the key instead.` };
    }
    return { ok: true, credentials: saved };
  }

  /* --------------------------- persistence -------------------------- */

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist();
    }, 2500);
    // Do not hold the event loop open just for a state flush.
    if (typeof this.saveTimer.unref === "function") this.saveTimer.unref();
  }

  persist() {
    try {
      const jobs = this.listJobs()
        .slice(0, MAX_JOBS_KEPT)
        .map((j) => ({ ...j, logs: j.logs.slice(-300) }));
      const state = { version: 1, savedAt: nowIso(), jobs, keys: [...this.keys.values()].slice(-20) };
      persistJsonEverywhere(STATE_FILENAME, state);
    } catch (e) {
      console.error("[hunter-store] persist failed:", e);
    }
  }

  private restore() {
    if (this.restored) return;
    this.restored = true;
    try {
      // Newest copy wins across the project dir, the sandbox snapshot store
      // and the home-dir backup — a session rollover that resets the project
      // to a stale snapshot can no longer erase a live hunt.
      const best = readNewestJson<{ version?: number; savedAt?: string; jobs?: HuntJob[]; keys?: SshKeyPair[] }>(STATE_FILENAME);
      if (!best?.parsed) return;
      const state = best.parsed;
      if (best.source !== primaryPathFor(STATE_FILENAME)) {
        console.log(`[hunter-store] using rescued state from ${best.source} (newer than the project copy)`);
      }
      for (const key of state.keys ?? []) this.keys.set(key.keyId, key);
      for (const job of state.jobs ?? []) {
        if (job.status === "starting" || job.status === "running") {
          if (job.stopRequested) {
            job.status = "stopped";
            job.logs.push({ ts: nowIso(), level: "info", message: "Server restarted — a stop had been requested, so this hunt stays stopped." });
          } else {
            job.status = "interrupted";
            job.logs.push({ ts: nowIso(), level: "warn", message: "Server restarted — resuming the hunt automatically…" });
          }
        }
        this.jobs.set(job.id, job);
      }
      console.log(`[hunter-store] restored ${this.jobs.size} job(s), ${this.keys.size} key(s)`);
    } catch (e) {
      console.error("[hunter-store] restore failed:", e);
    }
  }
}

const g = globalThis as unknown as { __hunterStore?: HunterStore };
export const hunterStore: HunterStore = g.__hunterStore ?? (g.__hunterStore = new HunterStore());
