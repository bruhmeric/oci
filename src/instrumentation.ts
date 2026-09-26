/**
 * Next.js server boot hook (nodejs runtime only).
 *
 * 1. Restores the hunt state (newest copy across the sandbox mirror roots —
 *    see src/lib/persist.ts; on Render/HUNTER_DATA_DIR there is a single
 *    root) and auto-resumes any hunt that a restart interrupted, so hunting
 *    survives server crashes and container reboots alike.
 * 2. Env bootstrap (Render / ephemeral disks): when the state store is empty
 *    — e.g. the disk was wiped by a new deploy — and HUNTER_AUTOSTART is on,
 *    a fresh hunt is created from the OCI_ and HUNT_ environment variables.
 *    That is what makes "hunt forever until I say stop" possible on hosts
 *    without persistent storage.
 * 3. Keep-alive self-ping: Render's free tier suspends an instance after 15
 *    minutes without inbound HTTP traffic. Every ~10 minutes we request our
 *    own public /api/health, which counts as inbound traffic and keeps the
 *    process (and therefore the hunt) alive around the clock. Works with any
 *    host via KEEPALIVE_URL; disable with KEEPALIVE_ENABLED=false.
 * 4. Installs process-level crash guards: a hunting server must not die on a
 *    stray unhandled rejection — the engine already catch-nets every retry
 *    path, so anything reaching here is logged loudly instead of killing
 *    hours of hunting.
 * 5. Runs a 60s keepalive flush while any hunt is live, keeping every state
 *    mirror fresh so an abrupt kill can never cost more than a minute.
 *
 * The hunt list API calls resumeInterruptedHunts() again as a fallback;
 * both paths are idempotent (the resume claim is synchronous).
 */

const g = globalThis as unknown as { __hunterBootHardened?: boolean };

/** Set once the store module is loaded; used by the crash guard below. */
let storeRef: typeof import("./lib/hunter/store") | null = null;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  /* ---------------- process-level crash guards (once) ---------------- */
  // Accessed via globalThis so the Edge-runtime compiler never sees a bare
  // `process.on` reference (it doesn't exist there — Turbopack warns).
  const proc = (globalThis as { process?: NodeJS.Process }).process;
  if (!g.__hunterBootHardened && proc && typeof proc.on === "function") {
    g.__hunterBootHardened = true;
    proc.on("unhandledRejection", (reason) => {
      console.error("[hunt-guard] unhandled rejection (hunt keeps running):", reason);
    });
    proc.on("uncaughtException", (err) => {
      // Deliberately NOT exiting: a dead server means a dead hunt until the
      // next container boot. Flush state so nothing is lost, then survive.
      console.error("[hunt-guard] uncaught exception (server kept alive, state flushed):", err);
      try {
        storeRef?.hunterStore.persist();
      } catch {
        /* nothing more we can do */
      }
    });
  }

  try {
    const { hunterStore } = await import("./lib/hunter/store");
    const { resumeInterruptedHunts } = await import("./lib/hunter/engine");
    const { bootstrapHuntFromEnv } = await import("./lib/hunter/envboot");
    storeRef = await import("./lib/hunter/store");
    const jobs = hunterStore.listJobs(); // forces state restore on first touch
    hunterStore.persist(); // seed/heal every mirror with the restored state

    /* ---------------- 1. resume interrupted hunts --------------------- */
    const interrupted = jobs.filter((j) => j.status === "interrupted").length;
    if (interrupted > 0) {
      console.log(`[instrumentation] resuming ${interrupted} interrupted hunt(s)…`);
      resumeInterruptedHunts();
    }

    /* ---------------- 2. env bootstrap (fresh / wiped disk) ------------ */
    if (interrupted === 0) {
      const boot = await bootstrapHuntFromEnv();
      console.log(`[instrumentation] env bootstrap: ${boot.note}`);
    }

    /* ---------------- 3. keep-alive self-ping (Render free tier) ------ */
    startKeepaliveSelfPing();

    /* ---------------- keepalive: flush state every 60s ---------------- */
    const keepalive = setInterval(() => {
      try {
        if (hunterStore.activeJob) hunterStore.persist();
      } catch {
        /* best-effort */
      }
    }, 60_000);
    if (typeof keepalive.unref === "function") keepalive.unref();
  } catch (e) {
    console.error("[instrumentation] hunt boot sequence failed:", e);
  }
}

/* ------------------------------------------------------------------ */
/* Keep-alive self-ping                                                 */
/* ------------------------------------------------------------------ */

function startKeepaliveSelfPing() {
  const rawBase =
    process.env.KEEPALIVE_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim() ||
    "";
  const base = rawBase.replace(/\/+$/, "");
  const enabled = Boolean(base) && process.env.KEEPALIVE_ENABLED?.trim().toLowerCase() !== "false";
  if (!enabled) {
    if (process.env.RENDER && !base) {
      console.warn("[keepalive] RENDER detected but RENDER_EXTERNAL_URL is missing — self-ping disabled.");
    }
    return;
  }

  const intervalSec = Math.min(
    1800,
    Math.max(60, parseInt(process.env.KEEPALIVE_INTERVAL_SEC ?? "", 10) || 600)
  );
  const url = `${base}/api/health`;
  let successes = 0;

  const ping = async () => {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "oci-hunter-keepalive/1.0" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        console.warn(`[keepalive] self-ping → HTTP ${res.status} (will retry next interval)`);
      } else if (successes === 0) {
        console.log(`[keepalive] self-ping OK → ${url}`);
      }
      successes += 1;
    } catch (e) {
      // A failed ping is logged but never fatal — next interval retries.
      console.warn(`[keepalive] self-ping failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // First ping shortly after boot (also verifies the health route works),
  // then on a fixed cadence with a small one-time jitter so a fleet of
  // services doesn't ping in lockstep.
  const firstDelay = 30_000 + Math.floor(Math.random() * 15_000);
  const kick = setTimeout(() => void ping(), firstDelay);
  if (typeof kick.unref === "function") kick.unref();

  const jitteredMs = (intervalSec + (Math.random() - 0.5) * Math.min(120, intervalSec * 0.2)) * 1000;
  const timer = setInterval(() => void ping(), jitteredMs);
  if (typeof timer.unref === "function") timer.unref();

  console.log(`[keepalive] self-ping armed → ${url} every ~${Math.round(jitteredMs / 1000)}s (fights Render free-tier spin-down)`);
}
