"use client";

import { Crosshair, Download, OctagonX, Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HuntJobSnapshot } from "@/lib/hunter/types";
import { LogConsole } from "./log-console";
import { SlotCard } from "./slot-card";
import { IdChip } from "./bits";
import { cn } from "@/lib/utils";

function fmtElapsed(fromIso: string, now: number, endIso?: string) {
  const start = new Date(fromIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : now;
  let s = Math.max(0, Math.floor((end - start) / 1000));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const JOB_BADGE: Record<string, string> = {
  starting: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  running: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  completed: "border-emerald-500/50 bg-emerald-500/15 text-emerald-300",
  stopped: "border-zinc-600/60 bg-zinc-700/20 text-zinc-400",
  error: "border-red-500/40 bg-red-500/10 text-red-300",
  interrupted: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

interface Props {
  job: HuntJobSnapshot | null;
  now: number;
  onStop: () => void;
  stopping: boolean;
  onResume: () => void;
  resuming: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
  keyDownloads: { keyId: string } | null;
}

export function HuntDashboard({ job, now, onStop, stopping, onResume, resuming, soundOn, onToggleSound, keyDownloads }: Props) {
  if (!job) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-700/70 bg-zinc-900/30 p-10 text-center">
        <Crosshair className="size-10 text-zinc-700" />
        <p className="max-w-md text-xs leading-relaxed text-zinc-500">
          No hunt running. Fill in the four steps above, then press <b className="text-emerald-400">START HUNTING</b>.
          The hunter will keep retrying until Oracle Cloud frees up Ampere A1 capacity — even if it takes hours.
        </p>
      </div>
    );
  }

  const launched = job.slots.filter((s) => s.status === "launched" || s.status === "running").length;
  const isLive = job.status === "starting" || job.status === "running";
  const retried =
    (job.stats.rateLimits ?? 0) + (job.stats.serverErrors ?? 0) + (job.stats.networkErrors ?? 0) + (job.stats.limitHits ?? 0);

  return (
    <div className="space-y-4">
      {/* stat strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: "Status", value: job.status.toUpperCase(), cls: JOB_BADGE[job.status] },
          { label: "Elapsed", value: fmtElapsed(job.stats.startedAt, now, job.stats.finishedAt), cls: "" },
          { label: "Total attempts", value: String(job.stats.totalAttempts), cls: "" },
          { label: "Auto-retried", value: String(retried), cls: retried > 0 ? "text-amber-300" : "" },
          { label: "Secured", value: `${launched} / ${job.slots.length}`, cls: launched > 0 ? "text-emerald-300" : "" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-600">{s.label}</div>
            <div
              className={cn(
                "mt-0.5 font-mono text-base font-bold",
                s.cls ? "" : "text-zinc-100",
                s.cls,
                s.label === "Status" && isLive && "animate-hunter-pulse"
              )}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {job.status === "interrupted" && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200 sm:flex-row sm:items-center">
          <p className="flex-1">
            This hunt was interrupted before it could auto-resume (the server was down when it tried). Already-launched
            instances keep running — press <b>Resume</b> to continue hunting with the attempt counters preserved.
          </p>
          {!job.stopRequested && (
            <Button
              type="button"
              size="sm"
              disabled={resuming}
              onClick={onResume}
              className="h-8 shrink-0 gap-1.5 bg-amber-600 text-white hover:bg-amber-500"
            >
              <Play className="size-3.5" />
              {resuming ? "RESUMING…" : "Resume hunt"}
            </Button>
          )}
        </div>
      )}

      {/* slots */}
      <div className={cn("grid gap-3", job.slots.length > 1 && "md:grid-cols-2")}>
        {job.slots.map((s) => (
          <SlotCard key={s.index} slot={s} now={now} region={job.config.credentials.region} />
        ))}
      </div>

      {/* controls + meta */}
      <div className="flex flex-wrap items-center gap-2">
        {isLive && (
          <Button
            type="button"
            variant="outline"
            onClick={onStop}
            disabled={stopping}
            className="gap-2 border-red-500/40 text-red-300 hover:bg-red-500/10 hover:text-red-200"
          >
            <OctagonX className="size-4" />
            {stopping ? "Stopping…" : "Stop hunt"}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onToggleSound}
          className="gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300"
          aria-label={soundOn ? "mute success beep" : "unmute success beep"}
        >
          {soundOn ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
          success beep {soundOn ? "on" : "off"}
        </Button>
        {keyDownloads?.keyId && launched > 0 && (
          <>
            <a href={`/api/ssh/${keyDownloads.keyId}/private`} className="inline-flex">
              <Button type="button" variant="outline" size="sm" className="gap-1.5 border-amber-500/40 text-[11px] text-amber-300 hover:bg-amber-500/10">
                <Download className="size-3.5" /> private key
              </Button>
            </a>
            <a href={`/api/ssh/${keyDownloads.keyId}/public`} className="inline-flex">
              <Button type="button" variant="outline" size="sm" className="gap-1.5 border-zinc-700 text-[11px] text-zinc-300">
                <Download className="size-3.5" /> public key
              </Button>
            </a>
          </>
        )}
        <span className="ml-auto font-mono text-[11px] text-zinc-600">hunt #{job.id}</span>
      </div>

      {job.network && (
        <div className="flex flex-wrap items-center gap-1.5">
          <IdChip value={job.network.vcnId} label="vcn" className="text-[10px]" />
          <IdChip value={job.network.subnetId} label="subnet" className="text-[10px]" />
          {job.network.created && (
            <span className="text-[10px] text-emerald-400/80">
              {job.network.cidr} · built by hunter {job.network.igwId ? "+ IGW" : ""}
            </span>
          )}
        </div>
      )}

      <LogConsole logs={job.logs} />
    </div>
  );
}
