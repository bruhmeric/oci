import { NextRequest } from "next/server";
import { hunterStore } from "@/lib/hunter/store";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = hunterStore.getJob(id);
  if (!job) return Response.json({ ok: false, message: "Hunt not found." }, { status: 404 });

  if (job.status === "completed" || job.status === "stopped" || job.status === "error" || job.status === "interrupted") {
    return Response.json({ ok: true, message: "Hunt already finished." });
  }

  job.stopRequested = true;
  hunterStore.log(job.id, "info", "Stop requested — finishing the current attempt, then halting.");
  hunterStore.markUpdated(job);
  return Response.json({ ok: true });
}
