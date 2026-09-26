import { NextRequest } from "next/server";
import { z } from "zod";
import { hunterStore } from "@/lib/hunter/store";
import { startHunt, resumeInterruptedHunts } from "@/lib/hunter/engine";
import { jobToSnapshot } from "@/lib/hunter/types";
import type { OciCredentials } from "@/lib/oci/client";

export const runtime = "nodejs";

const credentialsSchema = z.object({
  tenancyOcid: z.string().min(10),
  userOcid: z.string().min(10),
  fingerprint: z.string().min(10),
  // May be empty when reusing the key stored server-side from a previous hunt.
  privateKeyPem: z.string().default(""),
  region: z.string().min(3),
});

const launchSchema = z.object({
  credentials: credentialsSchema,
  compartmentOcid: z.string().optional().default(""),
  ocpus: z.number().int().min(1).max(4),
  memoryInGBs: z.number().int().min(1).max(24),
  bootVolumeSizeInGBs: z.number().int().min(47).max(200),
  imageOsId: z.string().min(2),
  instanceCount: z.number().int().min(1).max(2),
  namePrefix: z.string().regex(/^[a-zA-Z][a-zA-Z0-9-]{0,22}$/, "Prefix must start with a letter, letters/digits/dashes only"),
  networkMode: z.enum(["auto", "existing"]),
  existingSubnetId: z.string().optional(),
  retryIntervalSec: z.number().int().min(20).max(600),
  jitter: z.boolean(),
  sshPublicKey: z.string().min(40),
  sshKeyId: z.string().optional(),
  availabilityDomain: z.string().optional(),
  reuseCredentialsFrom: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ ok: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = launchSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return Response.json(
      { ok: false, message: `${issue.path.join(".") || "config"}: ${issue.message}` },
      { status: 400 }
    );
  }

  const cfg = parsed.data;
  if (cfg.networkMode === "existing" && !cfg.existingSubnetId) {
    return Response.json({ ok: false, message: "Existing-network mode needs a selected subnet." }, { status: 400 });
  }

  // The private key may live server-side (restored from a previous hunt).
  const resolved = hunterStore.reuseStoredPrivateKey(cfg.reuseCredentialsFrom, cfg.credentials);
  if (!resolved.ok || !resolved.credentials) {
    return Response.json({ ok: false, message: resolved.message ?? "Credentials incomplete." }, { status: 400 });
  }

  const active = hunterStore.activeJob;
  if (active) {
    return Response.json(
      { ok: false, message: `Hunt #${active.id} is still running — stop it first.` },
      { status: 409 }
    );
  }

  const job = hunterStore.createJob({
    ...cfg,
    credentials: resolved.credentials as OciCredentials,
    compartmentOcid: cfg.compartmentOcid || resolved.credentials.tenancyOcid,
  });

  startHunt(job);
  return Response.json({ ok: true, jobId: job.id, job: jobToSnapshot(job) });
}

export async function GET() {
  // Fallback for deployments where the boot hook could not run: any hunt the
  // store restored as "interrupted" is resumed the moment somebody lists them.
  resumeInterruptedHunts();
  const jobs = hunterStore.listJobs().slice(0, 10).map((j) => jobToSnapshot(j, 1));
  return Response.json({ ok: true, jobs });
}
