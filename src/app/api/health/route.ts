/**
 * Public health endpoint — deliberately NOT behind the password gate.
 *
 * Consumers:
 *  - the built-in keep-alive self-ping (instrumentation.ts) that keeps the
 *    Render free-tier instance from spinning down after 15 idle minutes;
 *  - external monitors (UptimeRobot / cron-job.org / any HTTPS pinger);
 *  - container orchestrators doing liveness probes.
 *
 * It leaks nothing sensitive: no credentials, no PEM keys, no log contents —
 * just enough signal to see that the hunter is alive and working.
 */
import { hunterStore } from "@/lib/hunter/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const body: Record<string, unknown> = {
    ok: true,
    service: "oci-a1-hunter",
    time: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
  };

  try {
    const active = hunterStore.activeJob;
    if (active) {
      body.hunt = {
        id: active.id,
        status: active.status,
        startedAt: active.stats.startedAt,
        totalAttempts: active.stats.totalAttempts,
        capacityMisses: active.stats.capacityMisses,
        slots: active.slots.length,
        secured: active.slots.filter((s) => s.status === "launched" || s.status === "running").length,
      };
    } else {
      body.hunt = null;
    }
    body.jobs = hunterStore.listJobs().length;
  } catch (e) {
    // Store trouble must not take the pinger down — report degraded, still 200.
    body.store = `degraded: ${e instanceof Error ? e.message : String(e)}`;
  }

  return Response.json(body, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
