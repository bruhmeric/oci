"use client";

import { Cpu, Gauge, HardDrive, Image as ImageIcon, MapPin, Rocket } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Stepper, StepHeader } from "./bits";
import { A1_FREE_ALLOWANCE, IMAGE_OS_OPTIONS } from "@/lib/hunter/types";
import { cn } from "@/lib/utils";

export interface Spec {
  ocpus: number;
  memoryInGBs: number;
  bootVolumeSizeInGBs: number;
  imageOsId: string;
  instanceCount: number;
  namePrefix: string;
  availabilityDomain?: string;
}

export interface ImageInfo {
  loading: boolean;
  sshUser: string;
  images: Array<{ id: string; displayName: string; timeCreated: string; sizeInGBs?: number }>;
}

interface Props {
  spec: Spec;
  onChange: (patch: Partial<Spec>) => void;
  ads: string[];
  imageInfo: ImageInfo | null;
  locked: boolean;
}

export function SpecCard({ spec, onChange, ads, imageInfo, locked }: Props) {
  const totals = {
    ocpus: spec.ocpus * spec.instanceCount,
    memory: spec.memoryInGBs * spec.instanceCount,
    disk: spec.bootVolumeSizeInGBs * spec.instanceCount,
  };
  const withinFree =
    totals.ocpus <= A1_FREE_ALLOWANCE.ocpus &&
    totals.memory <= A1_FREE_ALLOWANCE.memoryInGBs &&
    totals.disk <= A1_FREE_ALLOWANCE.bootVolumeGBs;
  const latestImage = imageInfo?.images?.[0];
  const osOpt = IMAGE_OS_OPTIONS.find((o) => o.id === spec.imageOsId);

  return (
    <section className="rounded-xl border border-zinc-800/80 bg-card/60 p-5 sm:p-6" aria-labelledby="step3">
      <StepHeader
        step={3}
        title="Instance Blueprint"
        icon={<Cpu className="size-4 text-emerald-400" />}
        right={
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wide text-emerald-300">
            VM.Standard.A1.Flex · ARM
          </span>
        }
      />

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Gauge className="size-3.5" /> OCPUs per instance
          </Label>
          <Stepper value={spec.ocpus} min={1} max={4} unit="cpu" onChange={(v) => onChange({ ocpus: v })} disabled={locked} />
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Cpu className="size-3.5" /> Memory per instance
          </Label>
          <Stepper value={spec.memoryInGBs} min={1} max={24} unit="GB" onChange={(v) => onChange({ memoryInGBs: v })} disabled={locked} />
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <HardDrive className="size-3.5" /> Boot volume
          </Label>
          <Stepper
            value={spec.bootVolumeSizeInGBs}
            min={47}
            max={200}
            unit="GB"
            onChange={(v) => onChange({ bootVolumeSizeInGBs: v })}
            disabled={locked}
          />
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Rocket className="size-3.5" /> Instances to hunt
          </Label>
          <div className="inline-flex rounded-lg border border-zinc-700/70 bg-zinc-900/60 p-0.5">
            {[1, 2].map((n) => (
              <button
                key={n}
                type="button"
                disabled={locked}
                onClick={() => onChange({ instanceCount: n })}
                className={cn(
                  "rounded-md px-4 py-1.5 font-mono text-sm font-semibold transition-colors disabled:opacity-50",
                  spec.instanceCount === n ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                ×{n}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <ImageIcon className="size-3.5" /> Operating system (aarch64)
          </Label>
          <Select value={spec.imageOsId} onValueChange={(v) => onChange({ imageOsId: v })} disabled={locked}>
            <SelectTrigger className="w-full border-zinc-700/70 bg-zinc-900/70 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IMAGE_OS_OPTIONS.map((o) => (
                <SelectItem key={o.id} value={o.id} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <MapPin className="size-3.5" /> Availability domain
          </Label>
          {ads.length > 1 ? (
            <Select
              value={spec.availabilityDomain ?? ads[0]}
              onValueChange={(v) => onChange({ availabilityDomain: v })}
              disabled={locked}
            >
              <SelectTrigger className="w-full border-zinc-700/70 bg-zinc-900/70 font-mono text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ads.map((a) => (
                  <SelectItem key={a} value={a} className="font-mono text-[11px]">
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="rounded-lg border border-zinc-700/70 bg-zinc-900/60 px-3 py-2 font-mono text-[11px] text-zinc-400">
              {ads.length === 1 ? `${ads[0]} (only one in region)` : "validate credentials to discover"}
            </div>
          )}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="prefix" className="text-xs text-zinc-400">
            Instance name prefix
          </Label>
          <Input
            id="prefix"
            value={spec.namePrefix}
            onChange={(e) => onChange({ namePrefix: e.target.value.replace(/[^a-zA-Z0-9-]/g, "") })}
            placeholder="sg-a1-hunter"
            className="w-full max-w-xs border-zinc-700/70 bg-zinc-900/70 font-mono text-xs"
            spellCheck={false}
            disabled={locked}
          />
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <div
          className={cn(
            "rounded-lg border p-3 font-mono text-xs",
            withinFree
              ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-300"
              : "border-amber-500/30 bg-amber-500/8 text-amber-300"
          )}
        >
          {spec.instanceCount} × ({spec.ocpus} OCPU · {spec.memoryInGBs} GB · {spec.bootVolumeSizeInGBs} GB) ={" "}
          {totals.ocpus} OCPU · {totals.memory} GB RAM · {totals.disk} GB disk{" "}
          {withinFree ? "— fits the Always Free allowance (4 / 24 / 200)" : "— EXCEEDS the Always Free allowance (4 / 24 / 200); expect LimitExceeded"}
        </div>
        {imageInfo && (
          <p className="truncate text-[11px] text-zinc-500" title={latestImage?.displayName}>
            {imageInfo.loading
              ? "Resolving latest image…"
              : latestImage
                ? `Will use: ${latestImage.displayName}${latestImage.sizeInGBs ? ` (${latestImage.sizeInGBs} GB min)` : ""} · SSH user “${imageInfo.sshUser}”`
                : "No image found for this OS — pick another."}
          </p>
        )}
        {!imageInfo && osOpt && (
          <p className="text-[11px] text-zinc-500">
            {osOpt.label} — the newest matching image is resolved automatically when the hunt starts · SSH user “{osOpt.sshUser}”
          </p>
        )}
      </div>
    </section>
  );
}
