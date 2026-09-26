/**
 * Environment-variable bootstrap — makes the hunter deployable on ephemeral
 * disks (Render free tier, Fly, Railway, plain Docker).
 *
 * On those platforms the filesystem is wiped on every deploy, so a hunt
 * that lived in `.data/hunter-state.json` cannot survive. The durable
 * source of truth becomes the ENVIRONMENT: OCI credentials, hunt spec and
 * the autostart flag are set once in the platform dashboard, and every
 * server boot re-creates the hunt from them.
 *
 * Bootstrap rules (called once from instrumentation.ts):
 *  - HUNTER_AUTOSTART must be truthy ("true"/"1"/"yes");
 *  - it only fires when the state store has NO jobs at all (fresh disk —
 *    existing jobs mean the resume machinery already owns the situation,
 *    and a hunt the user stopped on purpose must stay stopped);
 *  - credentials must be complete, or a loud one-line error is logged
 *    (visible in Render logs) and the boot continues normally.
 *
 * The private key may be pasted as a full PEM (newlines or literal "\n")
 * or base64-encoded PEM — the latter is the friendliest way to set a
 * multi-line secret in a hosting dashboard.
 */
import { hunterStore } from "./store";
import { generateSshKeyPair } from "./ssh";
import { IMAGE_OS_OPTIONS, A1_FREE_ALLOWANCE } from "./types";
import type { HuntConfig } from "./types";
import type { OciCredentials } from "@/lib/oci/client";
import {
  getTelegramSettings,
  updateTelegramSettings,
} from "@/lib/notify/telegram";

/* ------------------------------------------------------------------ */
/* Small env helpers                                                    */
/* ------------------------------------------------------------------ */

export function envBool(name: string, fallback = false): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const v = parseInt(process.env[name] ?? "", 10);
  if (Number.isNaN(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/* ------------------------------------------------------------------ */
/* Private key parsing                                                  */
/* ------------------------------------------------------------------ */

/**
 * Accept a PEM that arrives in any of the forms hosting dashboards produce:
 *  - real multi-line PEM (heredoc / docker-compose block scalar)
 *  - single-line PEM with literal \n escapes
 *  - base64 of the whole PEM (recommended for Render — one clean line)
 * Returns a normalized PEM or null.
 */
export function normalizePrivateKeyPem(raw: string | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/\r\n/g, "\n");
  // Literal "\n" escapes → real newlines
  if (!s.includes("\n") && s.includes("\\n")) s = s.replace(/\\n/g, "\n");
  // Not a PEM yet → try base64 of the whole key
  if (!s.includes("PRIVATE KEY")) {
    try {
      const decoded = Buffer.from(s.replace(/\s+/g, ""), "base64").toString("utf8");
      if (decoded.includes("PRIVATE KEY")) s = decoded.replace(/\r\n/g, "\n");
    } catch {
      /* not base64 — leave as-is; validation below will reject it */
    }
  }
  s = s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----/.test(s) ? s : null;
}

/* ------------------------------------------------------------------ */
/* Config from env                                                      */
/* ------------------------------------------------------------------ */

export function credentialsFromEnv(): OciCredentials | { error: string } {
  const missing: string[] = [];
  const tenancyOcid = process.env.OCI_TENANCY_OCID?.trim() ?? "";
  const userOcid = process.env.OCI_USER_OCID?.trim() ?? "";
  const fingerprint = process.env.OCI_FINGERPRINT?.trim() ?? "";
  const region = process.env.OCI_REGION?.trim() ?? "";
  const privateKeyPem = normalizePrivateKeyPem(process.env.OCI_PRIVATE_KEY);

  if (!tenancyOcid.startsWith("ocid1.tenancy")) missing.push("OCI_TENANCY_OCID");
  if (!userOcid.startsWith("ocid1.user")) missing.push("OCI_USER_OCID");
  if (fingerprint.replace(/[^0-9a-fA-F]/g, "").length < 32) missing.push("OCI_FINGERPRINT");
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(region)) missing.push("OCI_REGION");
  if (!privateKeyPem) missing.push("OCI_PRIVATE_KEY");

  if (missing.length > 0) {
    return { error: `incomplete credentials — missing/invalid: ${missing.join(", ")}` };
  }
  return { tenancyOcid, userOcid, fingerprint, region, privateKeyPem: privateKeyPem! } satisfies OciCredentials;
}

export function huntConfigFromEnv(): HuntConfig | { error: string } {
  const creds = credentialsFromEnv();
  if ("error" in creds) return creds;

  // Spec — defaults mirror the "max out the Always Free allowance" case.
  const ocpus = envInt("HUNT_OCPUS", A1_FREE_ALLOWANCE.ocpus, 1, 4);
  const memoryInGBs = envInt("HUNT_MEMORY_GBS", A1_FREE_ALLOWANCE.memoryInGBs, 1, 24);
  const bootVolumeSizeInGBs = envInt("HUNT_BOOT_VOLUME_GB", 50, 47, 200);
  const instanceCount = envInt("HUNT_INSTANCE_COUNT", 1, 1, 2);
  const retryIntervalSec = envInt("HUNT_RETRY_INTERVAL_SEC", 60, 20, 600);
  const jitter = envBool("HUNT_JITTER", true);

  const imageOsId = IMAGE_OS_OPTIONS.some((o) => o.id === process.env.HUNT_IMAGE_OS?.trim())
    ? process.env.HUNT_IMAGE_OS!.trim()
    : IMAGE_OS_OPTIONS[0].id;

  let namePrefix = (process.env.HUNT_NAME_PREFIX?.trim() || "a1-hunter").replace(/[^a-zA-Z0-9-]/g, "-");
  if (!/^[a-zA-Z]/.test(namePrefix)) namePrefix = `h${namePrefix}`;
  namePrefix = namePrefix.slice(0, 23).replace(/-+$/, "") || "a1-hunter";

  const compartmentOcid = process.env.OCI_COMPARTMENT_OCID?.trim() || creds.tenancyOcid;
  const existingSubnetId = process.env.HUNT_SUBNET_ID?.trim() || undefined;
  const availabilityDomain = process.env.HUNT_AVAILABILITY_DOMAIN?.trim() || undefined;

  /* SSH key — env wins; otherwise generate one server-side (downloadable
     from the dashboard after a slot launches). */
  const envSshKey = process.env.HUNT_SSH_PUBLIC_KEY?.trim();
  if (envSshKey && envSshKey.length >= 40) {
    return {
      credentials: creds,
      compartmentOcid,
      ocpus,
      memoryInGBs,
      bootVolumeSizeInGBs,
      imageOsId,
      instanceCount,
      namePrefix,
      networkMode: existingSubnetId ? "existing" : "auto",
      existingSubnetId,
      retryIntervalSec,
      jitter,
      sshPublicKey: envSshKey,
      availabilityDomain,
    };
  }

  const pair = generateSshKeyPair(`${namePrefix}-key`);
  hunterStore.saveKeyPair(pair);
  console.log(
    `[env-boot] SSH keypair generated server-side (keyId ${pair.keyId.slice(0, 8)}…) — download the private key from the dashboard after launch, or set HUNT_SSH_PUBLIC_KEY for a permanent one.`
  );
  return {
    credentials: creds,
    compartmentOcid,
    ocpus,
    memoryInGBs,
    bootVolumeSizeInGBs,
    imageOsId,
    instanceCount,
    namePrefix,
    networkMode: existingSubnetId ? "existing" : "auto",
    existingSubnetId,
    retryIntervalSec,
    jitter,
    sshPublicKey: pair.publicKey,
    sshKeyId: pair.keyId,
    availabilityDomain,
  };
}

/* ------------------------------------------------------------------ */
/* Telegram seeding                                                     */
/* ------------------------------------------------------------------ */

/** Arm Telegram notifications from env when nothing is configured yet. */
function seedTelegramFromEnv() {
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!chatId) return;
  const s = getTelegramSettings();
  if (s.enabled && s.chatId) return; // already configured — leave it alone
  if (s.chatId && s.chatId !== chatId) return; // user configured their own — respect it
  updateTelegramSettings({ enabled: envBool("TELEGRAM_ENABLED", true), chatId });
  console.log(`[env-boot] Telegram notifications armed for chat ${chatId} (bot token from TELEGRAM_BOT_TOKEN).`);
}

/* ------------------------------------------------------------------ */
/* Orchestrator                                                         */
/* ------------------------------------------------------------------ */

/**
 * Start a hunt from environment variables when the state store is empty
 * (fresh deploy on an ephemeral disk). Returns what happened, for the boot
 * log. Never throws — a broken env must not take the server down.
 */
export async function bootstrapHuntFromEnv(): Promise<{ started: boolean; note: string }> {
  try {
    seedTelegramFromEnv();

    if (!envBool("HUNTER_AUTOSTART")) {
      return { started: false, note: "HUNTER_AUTOSTART not set — waiting for a manual start from the dashboard." };
    }

    const existing = hunterStore.listJobs();
    if (existing.length > 0) {
      return { started: false, note: `state store has ${existing.length} job(s) — existing state wins, no env bootstrap needed.` };
    }

    const { startHunt } = await import("./engine");
    const config = huntConfigFromEnv();
    if ("error" in config) {
      const msg = `HUNTER_AUTOSTART is on but ${config.error}. Set them in the Render dashboard → Environment.`;
      console.error(`[env-boot] ${msg}`);
      return { started: false, note: msg };
    }

    const job = hunterStore.createJob(config);
    startHunt(job);
    const c = job.config;
    const line = `hunt #${job.id} started from environment — ${c.instanceCount} × VM.Standard.A1.Flex (${c.ocpus} OCPU / ${c.memoryInGBs} GB) in ${c.credentials.region}, retry every ${c.retryIntervalSec}s.`;
    console.log(`[env-boot] ${line}`);
    hunterStore.log(job.id, "info", `Bootstrapped from environment variables (ephemeral-disk deploy). ${line}`);
    return { started: true, note: line };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[env-boot] failed:", e);
    return { started: false, note: `bootstrap error: ${msg}` };
  }
}
