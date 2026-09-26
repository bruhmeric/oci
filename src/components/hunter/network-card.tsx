"use client";

import { Network, RefreshCw, Repeat, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Spinner, StepHeader } from "./bits";
import { cn } from "@/lib/utils";

export interface VcnWithSubnets {
  id: string;
  displayName: string;
  cidrBlocks: string[];
  subnets: Array<{ id: string; displayName: string; cidrBlock: string }>;
}

export interface NetworkCfg {
  mode: "auto" | "existing";
  existingVcnId: string;
  existingSubnetId: string;
}

interface Props {
  network: NetworkCfg;
  onChange: (patch: Partial<NetworkCfg>) => void;
  vcns: VcnWithSubnets[] | null;
  loadingVcns: boolean;
  onRefreshNetworks: () => void;
  retry: { intervalSec: number; jitter: boolean };
  onRetryChange: (patch: Partial<{ intervalSec: number; jitter: boolean }>) => void;
  locked: boolean;
  canQuery: boolean;
}

export function NetworkCard({ network, onChange, vcns, loadingVcns, onRefreshNetworks, retry, onRetryChange, locked, canQuery }: Props) {
  const selectedVcn = vcns?.find((v) => v.id === network.existingVcnId);

  return (
    <section className="rounded-xl border border-zinc-800/80 bg-card/60 p-5 sm:p-6" aria-labelledby="step4">
      <StepHeader step={4} title="Network & Retry Policy" icon={<Network className="size-4 text-emerald-400" />} />

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={locked}
          onClick={() => onChange({ mode: "auto" })}
          className={cn(
            "rounded-lg border p-3.5 text-left transition-colors disabled:opacity-50",
            network.mode === "auto"
              ? "border-emerald-500/50 bg-emerald-500/10"
              : "border-zinc-700/70 bg-zinc-900/50 hover:border-zinc-600"
          )}
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
            <span className={cn("size-2 rounded-full", network.mode === "auto" ? "bg-emerald-400" : "bg-zinc-600")} />
            Auto-build new VCN (recommended)
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
            Creates a dedicated VCN + internet gateway + subnet, and every instance receives a <b>brand-new VNIC</b> with a
            public IP. SSH port 22 is open via the default security list.
          </p>
        </button>

        <button
          type="button"
          disabled={locked}
          onClick={() => {
            onChange({ mode: "existing" });
            if (!vcns && canQuery) onRefreshNetworks();
          }}
          className={cn(
            "rounded-lg border p-3.5 text-left transition-colors disabled:opacity-50",
            network.mode === "existing"
              ? "border-emerald-500/50 bg-emerald-500/10"
              : "border-zinc-700/70 bg-zinc-900/50 hover:border-zinc-600"
          )}
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
            <span className={cn("size-2 rounded-full", network.mode === "existing" ? "bg-emerald-400" : "bg-zinc-600")} />
            Reuse existing VCN / subnet
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
            Launch inside a VCN you already run. Instances still get fresh VNICs with ephemeral public IPs.
          </p>
        </button>
      </div>

      {network.mode === "existing" && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-zinc-400">Virtual Cloud Network</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px] text-zinc-400"
                disabled={locked || !canQuery || loadingVcns}
                onClick={onRefreshNetworks}
              >
                {loadingVcns ? <Spinner className="size-3" /> : <RefreshCw className="size-3" />} Refresh
              </Button>
            </div>
            <Select
              value={network.existingVcnId}
              onValueChange={(v) => onChange({ existingVcnId: v, existingSubnetId: "" })}
              disabled={locked || !vcns?.length}
            >
              <SelectTrigger className="w-full border-zinc-700/70 bg-zinc-900/70 text-xs">
                <SelectValue placeholder={vcns?.length ? "Choose a VCN" : "No VCNs visible / not validated"} />
              </SelectTrigger>
              <SelectContent>
                {(vcns ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id} className="text-xs">
                    {v.displayName} ({v.cidrBlocks?.[0] ?? "…"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">Subnet</Label>
            <Select
              value={network.existingSubnetId}
              onValueChange={(v) => onChange({ existingSubnetId: v })}
              disabled={locked || !selectedVcn?.subnets?.length}
            >
              <SelectTrigger className="w-full border-zinc-700/70 bg-zinc-900/70 text-xs">
                <SelectValue
                  placeholder={selectedVcn ? (selectedVcn.subnets.length ? "Choose a subnet" : "No subnets in this VCN") : "Pick a VCN first"}
                />
              </SelectTrigger>
              <SelectContent>
                {(selectedVcn?.subnets ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    {s.displayName} ({s.cidrBlock})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Repeat className="size-3.5" /> Retry interval
            </Label>
            <span className="font-mono text-sm font-semibold text-emerald-300">{retry.intervalSec}s</span>
          </div>
          <Slider
            value={[retry.intervalSec]}
            min={20}
            max={300}
            step={5}
            onValueChange={([v]) => onRetryChange({ intervalSec: v })}
            disabled={locked}
            aria-label="retry interval seconds"
          />
          <p className="text-[11px] text-zinc-500">
            Each slot retries the launch API every {retry.intervalSec}s — 60s is a polite sweet spot for the hunt.
          </p>
        </div>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="jitter" className="text-xs text-zinc-400">
              Human-like jitter (±10%)
            </Label>
            <Switch id="jitter" checked={retry.jitter} onCheckedChange={(v) => onRetryChange({ jitter: v })} disabled={locked} />
          </div>
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-500">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-500/70" />
            Randomizes each wait so parallel hunters don't sync up. Rate-limit responses automatically back off 2×.
          </p>
        </div>
      </div>
    </section>
  );
}
