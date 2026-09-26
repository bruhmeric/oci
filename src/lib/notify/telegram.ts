/**
 * Telegram notifications for the hunt engine.
 *
 * Settings live server-side (persisted to .data/telegram.json, bot token
 * never sent to the browser). The engine calls the notify* helpers — every
 * send is fire-and-forget and can never break a hunt.
 */
import { persistJsonEverywhere, readNewestJson, primaryPathFor } from "@/lib/persist";
import type { HuntJob, InstanceSlot } from "@/lib/hunter/types";

const SETTINGS_FILENAME = "telegram.json";

export interface TelegramSettings {
  enabled: boolean;
  chatId: string;
  botToken: string; // server-side only, never returned to the client
  heartbeatMin: number;
}

const DEFAULTS: TelegramSettings = {
  enabled: false,
  chatId: "",
  botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  heartbeatMin: 30,
};

/* ------------------------------------------------------------------ */
/* Settings store (globalThis so HMR / route modules share one copy)   */
/* ------------------------------------------------------------------ */

interface TgGlobal {
  __tgSettings?: TelegramSettings;
}
const g = globalThis as unknown as TgGlobal;

function loadSettings(): TelegramSettings {
  if (g.__tgSettings) return g.__tgSettings;
  let s = { ...DEFAULTS };
  try {
    // Newest copy wins across project dir + snapshot-proof mirrors, so a
    // sandbox session rollover can't silently revert armed notifications.
    const best = readNewestJson<Partial<TelegramSettings>>(SETTINGS_FILENAME);
    if (best?.parsed) {
      const raw = best.parsed;
      if (best.source !== primaryPathFor(SETTINGS_FILENAME)) {
        console.log(`[telegram] using rescued settings from ${best.source}`);
      }
      s = {
        enabled: Boolean(raw.enabled),
        chatId: String(raw.chatId ?? ""),
        botToken: String(raw.botToken || DEFAULTS.botToken),
        heartbeatMin: Number(raw.heartbeatMin) > 0 ? Number(raw.heartbeatMin) : 30,
      };
    }
  } catch {
    /* corrupted file — fall back to defaults */
  }
  g.__tgSettings = s;
  return s;
}

function saveSettings(s: TelegramSettings) {
  g.__tgSettings = s;
  try {
    persistJsonEverywhere(SETTINGS_FILENAME, s);
  } catch {
    /* persistence is best-effort */
  }
}

export function getTelegramSettings(): TelegramSettings {
  return { ...loadSettings() };
}

export function updateTelegramSettings(patch: Partial<Omit<TelegramSettings, "botToken">> & { botToken?: string }): TelegramSettings {
  const cur = loadSettings();
  const next: TelegramSettings = {
    enabled: patch.enabled ?? cur.enabled,
    chatId: (patch.chatId ?? cur.chatId).trim(),
    botToken: (patch.botToken && patch.botToken.trim()) || cur.botToken,
    heartbeatMin: patch.heartbeatMin && patch.heartbeatMin > 0 ? Math.min(patch.heartbeatMin, 720) : cur.heartbeatMin,
  };
  saveSettings(next);
  return { ...next };
}

/** Masked token for UI display, e.g. "8644…enz4". */
export function maskToken(token: string): string {
  if (!token || token.length < 12) return "";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/* Telegram API helpers                                                */
/* ------------------------------------------------------------------ */

async function tgApi<T = any>(method: string, body: unknown): Promise<{ ok: boolean; result?: T; description?: string }> {
  const token = loadSettings().botToken;
  if (!token) return { ok: false, description: "No bot token configured on the server." };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return data && typeof data.ok === "boolean" ? data : { ok: false, description: `HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, description: e?.name === "TimeoutError" ? "Telegram API timed out" : e?.message ?? "network error" };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Send a message if notifications are enabled + configured. Never throws. */
export async function sendTelegram(html: string): Promise<boolean> {
  const s = loadSettings();
  if (!s.enabled || !s.chatId || !s.botToken) return false;
  const r = await tgApi("sendMessage", {
    chat_id: s.chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  return r.ok;
}

/** Unconditional send (used by the Test button) — returns an error message on failure. */
export async function sendTelegramForce(html: string): Promise<{ ok: boolean; error?: string }> {
  const r = await tgApi("sendMessage", {
    chat_id: loadSettings().chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  return r.ok ? { ok: true } : { ok: false, error: r.description ?? "unknown error" };
}

/** Chats the bot has seen (user must message it first). */
export async function detectTelegramChats(): Promise<{ ok: boolean; chats?: Array<{ chatId: string; name: string }>; error?: string }> {
  const r = await tgApi<any>("getUpdates", { limit: 50 });
  if (!r.ok) return { ok: false, error: r.description ?? "Telegram API error" };
  const seen = new Map<string, { chatId: string; name: string }>();
  for (const u of r.result ?? []) {
    const chat = u?.message?.chat ?? u?.edited_message?.chat ?? u?.channel_post?.chat;
    if (!chat?.id) continue;
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.title || chat.username || String(chat.id);
    seen.set(String(chat.id), { chatId: String(chat.id), name });
  }
  return { ok: true, chats: [...seen.values()] };
}

/* ------------------------------------------------------------------ */
/* Hunt event notifiers                                                */
/* ------------------------------------------------------------------ */

const fire = (p: Promise<unknown>) => void p.catch(() => {});

export function notifyHuntStarted(job: HuntJob) {
  const c = job.config;
  fire(
    sendTelegram(
      [
        `🎯 <b>Hunt started</b> (<code>#${job.id}</code>)`,
        ``,
        `• Region: <code>${escapeHtml(c.credentials.region)}</code>`,
        `• Target: ${c.instanceCount} × VM.Standard.A1.Flex — ${c.ocpus} OCPU / ${c.memoryInGBs} GB`,
        `• Image: ${escapeHtml(job.imageResolvedName ?? c.imageOsId)}`,
        `• Retry every ${c.retryIntervalSec}s — I'll ping you the moment a server is secured.`,
      ].join("\n")
    )
  );
}

export function notifyHuntResumed(job: HuntJob) {
  const active = job.slots.filter((s) => s.status === "hunting" || s.status === "launching").length;
  const secured = job.slots.filter((s) => s.status === "launched" || s.status === "running").length;
  fire(
    sendTelegram(
      [
        `🔄 <b>Hunt auto-resumed</b> (<code>#${job.id}</code>)`,
        ``,
        `• The server restarted — the hunt continues where it left off.`,
        `• Attempts so far: ${job.stats.totalAttempts} (${job.stats.capacityMisses} capacity misses) — counters preserved`,
        `• Slots: ${active} hunting again · ${secured} secured · ${job.slots.length - active - secured} finished`,
      ].join("\n")
    )
  );
}

export function notifySlotLaunched(job: HuntJob, slot: InstanceSlot) {
  fire(
    sendTelegram(
      [
        `🚀 <b>Instance LAUNCHED</b> — ${escapeHtml(slot.displayName)} is provisioning`,
        ``,
        `• OCID: <code>${escapeHtml(slot.instance?.ocid ?? "")}</code>`,
        `• Public IP: fetching… next message will have it + the SSH command.`,
      ].join("\n")
    )
  );
}

export function notifySlotRunning(job: HuntJob, slot: InstanceSlot) {
  const inst = slot.instance;
  fire(
    sendTelegram(
      [
        `✅ <b>SERVER READY — ${escapeHtml(slot.displayName)}</b>`,
        ``,
        `• Public IP: <code>${escapeHtml(inst?.publicIp ?? "pending — see OCI console")}</code>`,
        `• State: RUNNING · ${escapeHtml(inst?.lifecycleState ?? "")}`,
        ``,
        `SSH command:`,
        `<code>ssh -i your-key.pem ${escapeHtml(inst?.sshUser ?? "ubuntu")}@${escapeHtml(inst?.publicIp ?? "")}</code>`,
      ].join("\n")
    )
  );
}

/* ------------------------------------------------------------------ */
/* Failure & throttle reporting                                        */
/* ------------------------------------------------------------------ */

/** Per-hunt memory of which retryable issue types already alerted (anti-spam). */
const retryIssueSeen = new Map<string, Set<string>>();

/**
 * First-occurrence alert for retryable issues — rate limits (429),
 * transient 5xx, network hiccups and service-limit cooldowns. Fires at most
 * once per hunt per issue type so a throttled hunt never spams the chat;
 * running totals ride the heartbeat instead. Capacity misses are deliberately
 * NOT alerted — "out of host capacity" is the hunt's normal resting state.
 * Returns the message that was queued, or null when suppressed. If the
 * send fails (not armed / network), the memory is released so the next
 * occurrence can try again.
 */
export function notifyRetryIssue(
  job: HuntJob,
  kind: "rate-limit" | "server-error" | "network" | "limit",
  detail: string,
  waitSec: number
): string | null {
  let seen = retryIssueSeen.get(job.id);
  if (!seen) {
    seen = new Set();
    retryIssueSeen.set(job.id, seen);
  }
  if (seen.has(kind)) return null;
  seen.add(kind);
  const label =
    kind === "rate-limit"
      ? "Rate limit (429)"
      : kind === "server-error"
        ? "Transient server error (5xx)"
        : kind === "network"
          ? "Network issue"
          : "Service limit reached (A1 quota full)";
  const msg = [
    `⚠️ <b>${label} — first occurrence</b> (<code>#${job.id}</code>)`,
    ``,
    `• ${escapeHtml(detail.slice(0, 300))}`,
    `• Auto-handled: ${kind === "limit" ? "cooling down" : `backing off`} ~${waitSec >= 120 ? `${Math.round(waitSec / 60)} min` : `${waitSec}s`}, then retrying — the hunt continues.`,
    `• Running totals appear in every status update. No repeat alerts for this issue type.`,
  ].join("\n");
  void sendTelegram(msg).then((sent) => {
    if (!sent) seen!.delete(kind); // send failed → let the next occurrence retry the alert
  });
  return msg;
}

/** A slot gave up for good — API block (auth), service limit, or fatal launch error. */
export function notifySlotFatal(job: HuntJob, slot: InstanceSlot, headline: string, detail: string, stopsHunt: boolean): string {
  const msg = [
    `🚫 <b>${escapeHtml(headline)}</b> — ${escapeHtml(slot.displayName)} (<code>#${job.id}</code>)`,
    ``,
    `• ${escapeHtml(detail.slice(0, 500))}`,
    stopsHunt ? `• This stops the <b>whole hunt</b> — fix the cause, then start a new hunt.` : `• This slot gives up; other slots keep hunting.`,
  ].join("\n");
  fire(sendTelegram(msg));
  return msg;
}

/** A launched instance hit trouble after launch — bad state, or a provisioning/IP timeout. */
export function notifyPostLaunchFailure(job: HuntJob, slot: InstanceSlot, detail: string): string {
  const msg = [
    `🧯 <b>Launched instance in trouble</b> — ${escapeHtml(slot.displayName)} (<code>#${job.id}</code>)`,
    ``,
    `• ${escapeHtml(detail.slice(0, 400))}`,
    `• The hunt itself is unaffected — check the OCI console.`,
  ].join("\n");
  fire(sendTelegram(msg));
  return msg;
}

export function notifyHuntFatal(job: HuntJob, message: string) {
  retryIssueSeen.delete(job.id);
  fire(
    sendTelegram(
      [`❌ <b>Hunt aborted</b> (<code>#${job.id}</code>)`, ``, escapeHtml(message.slice(0, 600))].join("\n")
    )
  );
}

export function notifyHuntFinished(job: HuntJob) {
  retryIssueSeen.delete(job.id);
  const launched = job.slots.filter((s) => s.status === "launched" || s.status === "running").length;
  const mins = Math.max(1, Math.round((Date.now() - new Date(job.stats.startedAt).getTime()) / 60000));
  const reasons = job.slots
    .filter((s) => (s.status === "failed" || s.status === "limit") && s.lastError)
    .map((s) => `• ${escapeHtml(s.displayName)}: ${escapeHtml(s.lastError!.slice(0, 160))}`);
  const throttled = (job.stats.rateLimits ?? 0) + (job.stats.serverErrors ?? 0) + (job.stats.networkErrors ?? 0);
  const lines = [
    `🏁 <b>Hunt finished</b> (<code>#${job.id}</code>) — ${job.status}`,
    ``,
    `• Secured: <b>${launched}/${job.slots.length}</b> instance(s)`,
    `• Attempts: ${job.stats.totalAttempts} (${job.stats.capacityMisses} capacity misses${throttled > 0 ? `, ${throttled} throttles auto-retried` : ""})`,
    `• Duration: ~${mins} min`,
  ];
  if (reasons.length > 0) lines.push(``, `<b>Slot results:</b>`, ...reasons);
  fire(sendTelegram(lines.join("\n")));
}

/* ------------------------------------------------------------------ */
/* Heartbeat — periodic "current status" updates                       */
/* ------------------------------------------------------------------ */

const heartbeats = new Map<string, NodeJS.Timeout>();

export function startHeartbeat(job: HuntJob) {
  stopHeartbeat(job.id);
  const s = loadSettings();
  const ms = Math.max(5, s.heartbeatMin) * 60 * 1000;
  const timer = setInterval(() => {
    if (job.status !== "running" && job.status !== "starting") {
      stopHeartbeat(job.id);
      return;
    }
    const active = job.slots.filter((x) => x.status === "hunting" || x.status === "launching" || x.status === "limit");
    if (active.length === 0) return; // finishing on its own — the finish message covers it
    const mins = Math.round((Date.now() - new Date(job.stats.startedAt).getTime()) / 60000);
    const rl = job.stats.rateLimits ?? 0;
    const se = job.stats.serverErrors ?? 0;
    const ne = job.stats.networkErrors ?? 0;
    const lh = job.stats.limitHits ?? 0;
    const lines = [
      `⏳ <b>Still hunting</b> (<code>#${job.id}</code>)`,
      ``,
      `• ${active.length} slot(s) active · ${job.slots.length - active.length} done`,
      `• Total attempts: ${job.stats.totalAttempts} (${job.stats.capacityMisses} × "out of host capacity")`,
    ];
    if (rl + se + ne + lh > 0) lines.push(`• Throttles absorbed: ${rl} rate-limit · ${se} server-error · ${ne} network · ${lh} limit-cooldown`);
    lines.push(`• Uptime: ~${mins} min`);
    fire(sendTelegram(lines.join("\n")));
  }, ms);
  if (typeof timer.unref === "function") timer.unref();
  heartbeats.set(job.id, timer);
}

export function stopHeartbeat(jobId: string) {
  const t = heartbeats.get(jobId);
  if (t) {
    clearInterval(t);
    heartbeats.delete(jobId);
  }
}
