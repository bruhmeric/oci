"use client";

import { CircleCheck, CircleX, Hourglass, Loader2, Lock, Radar, Server, TerminalSquare } from "lucide-react";
import type { InstanceSlot } from "@/lib/hunter/types";
import { CopyButton, IdChip } from "./bits";
import { cn } from "@/lib/utils";

function fmtCountdown(now: number, iso?: string) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "any moment…";
  const s = Math.ceil(ms / 1000);
  return s > 90 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

const STATUS_META: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  queued: { label: "Queued", cls: "border-zinc-600/50 bg-zinc-700/20 text-zinc-400", icon: <Hourglass className="size-3" /> },
  hunting: { label: "Hunting", cls: "border-orange-500/40 bg-orange-500/10 text-orange-300", icon: <Radar className="size-3" /> },
  launching: { label: "Launching", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300", icon: <Loader2 className="size-3 animate-spin" /> },
  launched: { label: "Provisioning", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", icon: <Loader2 className="size-3 animate-spin" /> },
  running: { label: "RUNNING", cls: "border-emerald-400/60 bg-emerald-500/20 text-emerald-300", icon: <CircleCheck className="size-3" /> },
  limit: { label: "Limit cooldown", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300", icon: <Lock className="size-3" /> },
  failed: { label: "Failed", cls: "border-red-500/40 bg-red-500/10 text-red-300", icon: <CircleX className="size-3" /> },
  stopped: { label: "Stopped", cls: "border-zinc-600/50 bg-zinc-700/20 text-zinc-400", icon: <CircleX className="size-3" /> },
};

export function SlotCard({ slot, now, region }: { slot: InstanceSlot; now: number; region: string }) {
  const meta = STATUS_META[slot.status] ?? STATUS_META.queued;
  const active = slot.status === "hunting" || slot.status === "launching" || slot.status === "launched";
  const sshUser = slot.instance?.sshUser ?? "ubuntu";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border p-4 transition-colors",
        slot.status === "running"
          ? "border-emerald-500/40 bg-emerald-500/8"
          : slot.status === "failed"
            ? "border-red-500/30 bg-red-500/5"
            : "border-zinc-800/80 bg-zinc-900/40"
      )}
    >
      {active && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden">
          <div className="animate-scan h-px w-1/4 bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Server className="size-4 text-zinc-500" />
        <span className="font-mono text-sm font-semibold text-zinc-100">{slot.displayName}</span>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
            meta.cls,
            slot.status === "hunting" && "animate-hunter-pulse"
          )}
        >
          {meta.icon}
          {meta.label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
        <div className="rounded-lg bg-zinc-950/60 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-600">Attempts</div>
          <div className="font-mono text-sm text-zinc-200">{slot.attempts}</div>
        </div>
        <div className="rounded-lg bg-zinc-950/60 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-600">
            {slot.status === "hunting" || slot.status === "limit" ? "Next try in" : "Last try"}
          </div>
          <div className="font-mono text-sm text-zinc-200">
            {slot.status === "hunting" || slot.status === "limit"
              ? (fmtCountdown(now, slot.nextAttemptAt) ?? "—")
              : slot.lastAttemptAt
                ? new Date(slot.lastAttemptAt).toLocaleTimeString([], { hour12: false })
                : "—"}
          </div>
        </div>
      </div>

      {slot.lastError && slot.status !== "running" && (
        <p className="mt-2 truncate rounded-lg bg-zinc-950/60 px-2.5 py-2 font-mono text-[11px] text-orange-300/80" title={slot.lastError}>
          {slot.lastError}
        </p>
      )}

      {slot.instance && (
        <div className="mt-3 space-y-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/80">
              {slot.instance.lifecycleState}
            </span>
            {slot.instance.publicIp ? (
              <span className="font-mono text-lg font-bold tracking-wide text-emerald-300">{slot.instance.publicIp}</span>
            ) : (
              <span className="text-xs text-zinc-500">public IP pending…</span>
            )}
            {slot.instance.publicIp && <CopyButton text={slot.instance.publicIp} label="IP" />}
          </div>
          {slot.instance.publicIp && (
            <div className="flex items-center gap-2 rounded-md bg-zinc-950/70 px-2.5 py-2">
              <TerminalSquare className="size-3.5 shrink-0 text-emerald-400/70" />
              <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-200">
                ssh -i oci-hunter-key.pem {sshUser}@{slot.instance.publicIp}
              </code>
              <CopyButton text={`ssh -i oci-hunter-key.pem ${sshUser}@${slot.instance.publicIp}`} />
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            <IdChip value={slot.instance.ocid} label="instance" className="text-[10px]" />
            {slot.instance.privateIp && <IdChip value={slot.instance.privateIp} label="private" className="text-[10px]" />}
            <a
              href={`https://console.${region}.oraclecloud.com/compute/instances`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md border border-zinc-700/60 bg-zinc-800/40 px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:border-emerald-500/50 hover:text-emerald-300"
            >
              open in console ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
