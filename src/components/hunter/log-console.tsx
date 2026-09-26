"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";
import type { LogEntry } from "@/lib/hunter/types";
import { cn } from "@/lib/utils";

const LEVEL_STYLES: Record<string, { dot: string; text: string; tag: string }> = {
  info: { dot: "bg-sky-400", text: "text-zinc-300", tag: "text-sky-400" },
  success: { dot: "bg-emerald-400", text: "text-emerald-300", tag: "text-emerald-400" },
  warn: { dot: "bg-amber-400", text: "text-amber-200/90", tag: "text-amber-400" },
  error: { dot: "bg-red-500", text: "text-red-300", tag: "text-red-400" },
  retry: { dot: "bg-orange-400", text: "text-orange-200/80", tag: "text-orange-400" },
  debug: { dot: "bg-zinc-500", text: "text-zinc-500", tag: "text-zinc-500" },
};

function fmtTime(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour12: false });
  } catch {
    return "--:--:--";
  }
}

export function LogConsole({ logs, height = "h-80" }: { logs: LogEntry[]; height?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center gap-2 border-b border-zinc-800/80 bg-zinc-900/60 px-3 py-2">
        <Terminal className="size-3.5 text-emerald-400" />
        <span className="font-mono text-[11px] font-semibold tracking-wider text-zinc-400">hunt.log</span>
        <span className="ml-auto font-mono text-[10px] text-zinc-600">{logs.length} lines</span>
      </div>
      <div ref={ref} onScroll={onScroll} className={cn("hunter-scroll overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed", height)}>
        {logs.length === 0 ? (
          <p className="py-8 text-center text-zinc-600">waiting for the hunt to begin…</p>
        ) : (
          logs.map((l, i) => {
            const s = LEVEL_STYLES[l.level] ?? LEVEL_STYLES.info;
            return (
              <div key={i} className="flex gap-2 whitespace-pre-wrap break-all">
                <span className="shrink-0 text-zinc-600">{fmtTime(l.ts)}</span>
                {l.slot !== undefined && (
                  <span className={cn("shrink-0 font-semibold", s.tag)}>[slot-{l.slot + 1}]</span>
                )}
                <span className={cn("min-w-0", s.text)}>{l.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
