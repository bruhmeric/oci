"use client";

import { useCallback, useState } from "react";
import { Check, Copy, Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function CopyButton({ text, label, className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Copy failed — select the text manually");
    }
  }, [text]);
  return (
    <Button type="button" variant="outline" size="sm" onClick={onCopy} className={cn("h-7 gap-1.5 px-2.5", className)}>
      {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
      {label ?? (copied ? "Copied" : "Copy")}
    </Button>
  );
}

/** Truncated monospace chip for OCIDs and long identifiers. */
export function IdChip({ value, label, className }: { value: string; label?: string; className?: string }) {
  return (
    <button
      type="button"
      title={`${label ? label + "\n" : ""}${value} — click to copy`}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => toast.success(`${label ?? "Value"} copied`),
          () => toast.error("Copy failed")
        );
      }}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/40 px-2 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-300",
        className
      )}
    >
      {label ? <span className="shrink-0 text-zinc-500">{label}</span> : null}
      <span className="truncate">{value}</span>
    </button>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-zinc-700/70 bg-zinc-900/60">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 rounded-l-lg rounded-r-none text-zinc-400 hover:text-emerald-300"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
        aria-label="decrease"
      >
        <Minus className="size-3.5" />
      </Button>
      <div className="min-w-14 px-2 text-center font-mono text-sm font-semibold tabular-nums text-zinc-100">
        {value}
        {unit ? <span className="ml-0.5 text-[11px] font-normal text-zinc-500">{unit}</span> : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 rounded-r-lg rounded-l-none text-zinc-400 hover:text-emerald-300"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
        aria-label="increase"
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

export function StepHeader({
  step,
  title,
  icon,
  done,
  right,
}: {
  step: number;
  title: string;
  icon: React.ReactNode;
  done?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-bold",
          done
            ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
            : "border-zinc-700/70 bg-zinc-800/50 text-zinc-400"
        )}
      >
        {done ? <Check className="size-4" /> : step}
      </div>
      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-wide text-zinc-100">
        {icon}
        <span className="truncate uppercase">{title}</span>
      </div>
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-emerald-400", className)} />;
}
