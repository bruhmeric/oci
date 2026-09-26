import { NextRequest } from "next/server";
import { hunterStore } from "@/lib/hunter/store";
import { resumeHunt } from "@/lib/hunter/engine";
import { jobToSnapshot } from "@/lib/hunter/types";

export const runtime = "nodejs";

/** Manual resume for a hunt that shows as "interrupted" (safety valve — the boot hook auto-resumes normally). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = hunterStore.getJob(id);
  if (!job) return Response.json({ ok: false, message: "Hunt not found." }, { status: 404 });
  if (job.status !== "interrupted") {
    return Response.json(
      { ok: false, message: `Hunt #${id} is “${job.status}” — only interrupted hunts can be resumed. Use the pre-filled form to start a fresh one.` },
      { status: 409 }
    );
  }
  if (job.stopRequested) {
    return Response.json(
      { ok: false, message: "This hunt was stopped — start a new one instead (the form is already pre-filled from it)." },
      { status: 409 }
    );
  }
  const active = hunterStore.activeJob;
  if (active && active.id !== job.id) {
    return Response.json({ ok: false, message: `Hunt #${active.id} is already running — stop it first.` }, { status: 409 });
  }
  resumeHunt(job);
  return Response.json({ ok: true, job: jobToSnapshot(job) });
}
