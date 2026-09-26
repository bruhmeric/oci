import { NextRequest } from "next/server";
import { hunterStore } from "@/lib/hunter/store";
import { jobToSnapshot } from "@/lib/hunter/types";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = hunterStore.getJob(id);
  if (!job) return Response.json({ ok: false, message: "Hunt not found." }, { status: 404 });
  return Response.json({ ok: true, job: jobToSnapshot(job) });
}
