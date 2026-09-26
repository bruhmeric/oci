"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, BellRing, MessageCircle, Radar, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Spinner, StepHeader } from "./bits";
import { cn } from "@/lib/utils";

interface TgState {
  enabled: boolean;
  chatId: string;
  heartbeatMin: number;
  botConfigured: boolean;
  botMask?: string;
}

interface Props {
  locked: boolean;
}

export function TelegramCard({ locked }: Props) {
  const [state, setState] = useState<TgState | null>(null);
  const [chatId, setChatId] = useState("");
  const [heartbeatMin, setHeartbeatMin] = useState(30);
  const [detecting, setDetecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/telegram/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setState(d);
          setChatId(d.chatId ?? "");
          setHeartbeatMin(d.heartbeatMin ?? 30);
        }
      })
      .catch(() => {});
  }, []);

  const save = async (patch: { enabled?: boolean; chatId?: string; heartbeatMin?: number }) => {
    setSaving(true);
    try {
      const res = await fetch("/api/telegram/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: patch.enabled ?? state?.enabled ?? false,
          chatId: patch.chatId ?? chatId,
          heartbeatMin: patch.heartbeatMin ?? heartbeatMin,
        }),
      });
      const d = await res.json();
      if (d.ok) {
        setState(d);
        setChatId(d.chatId);
        toast.success(d.enabled ? "Telegram notifications ON" : "Telegram notifications off");
      } else toast.error(d.message ?? "Save failed");
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSaving(false);
    }
  };

  const detect = async () => {
    setDetecting(true);
    try {
      const res = await fetch("/api/telegram/detect", { method: "POST" });
      const d = await res.json();
      if (d.ok && d.chats?.length) {
        const c = d.chats[0];
        setChatId(c.chatId);
        await save({ chatId: c.chatId });
        toast.success(`Found chat: ${c.name} (${c.chatId}) — saved.`);
        if (d.chats.length > 1) toast.info(`${d.chats.length - 1} more chat(s) found — using the most recent.`);
      } else {
        toast.error(d.message ?? "No chats found", { description: d.hint });
      }
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setDetecting(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/telegram/test", { method: "POST" });
      const d = await res.json();
      if (d.ok) toast.success("Test message sent — check Telegram!");
      else toast.error(d.message ?? "Send failed", { description: d.hint });
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setTesting(false);
    }
  };

  const configured = Boolean(state?.chatId);

  return (
    <section className="rounded-xl border border-zinc-800/80 bg-card/60 p-5 sm:p-6" aria-labelledby="step5">
      <StepHeader
        step={5}
        title="Telegram Notifications"
        icon={<Bell className="size-4 text-emerald-400" />}
        done={Boolean(state?.enabled && configured)}
        right={
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
              state?.enabled && configured
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-700 bg-zinc-800/50 text-zinc-400"
            )}
          >
            {state?.enabled && configured ? <BellRing className="size-3" /> : <Bell className="size-3" />}
            {state?.enabled && configured ? "armed" : "off"}
          </span>
        }
      />

      <div className="mt-5 space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3.5">
          <div className="min-w-0">
            <p className="text-xs font-medium text-zinc-200">Notify me on Telegram</p>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              Messages: hunt started · heartbeat status every {heartbeatMin} min · <b className="text-emerald-400/90">server secured (with public IP + SSH command)</b> · fatal errors.
              {state?.botMask ? ` Bot ${state.botMask} is configured on the server.` : ""}
            </p>
          </div>
          <Switch
            checked={Boolean(state?.enabled)}
            disabled={locked || saving || !configured}
            onCheckedChange={(v) => save({ enabled: v })}
            aria-label="Toggle Telegram notifications"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="tg-chat" className="text-xs text-zinc-400">
              Your Telegram Chat ID
            </Label>
            <div className="flex gap-2">
              <Input
                id="tg-chat"
                value={chatId}
                onChange={(e) => setChatId(e.target.value.trim())}
                onBlur={() => chatId !== state?.chatId && configured && save({ chatId })}
                placeholder="e.g. 123456789 — or click Detect"
                className="border-zinc-700/70 bg-zinc-900/70 font-mono text-xs"
                spellCheck={false}
                disabled={locked}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0 gap-1.5 border-zinc-700 text-xs text-zinc-300"
                disabled={locked || detecting}
                onClick={detect}
              >
                {detecting ? <Spinner /> : <Radar className="size-3.5" />} Detect
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              First time? Open Telegram → search <b>@notifyocibot</b> → press <b>Start</b> (or send any message) → come back and hit Detect.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">Status heartbeat</Label>
            <Select value={String(heartbeatMin)} onValueChange={(v) => { const n = Number(v); setHeartbeatMin(n); if (configured) save({ heartbeatMin: n }); }} disabled={locked}>
              <SelectTrigger className="w-full border-zinc-700/70 bg-zinc-900/70 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["15", "30", "60", "180"].map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">
                    every {Number(m) >= 60 ? `${Number(m) / 60} h` : `${m} min`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 bg-sky-600 text-xs text-white hover:bg-sky-500"
            disabled={locked || !configured || testing || saving}
            onClick={test}
          >
            {testing ? <Spinner className="text-white" /> : <Send className="size-3.5" />} Send test message
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-zinc-700 text-xs text-zinc-300"
            disabled={locked || saving || !chatId || chatId === state?.chatId}
            onClick={() => save({ chatId })}
          >
            <MessageCircle className="size-3.5" /> Save chat ID
          </Button>
          {state && !state.botConfigured && (
            <span className="text-[11px] text-amber-300/80">No bot token on the server — set TELEGRAM_BOT_TOKEN in .env</span>
          )}
        </div>
      </div>
    </section>
  );
}
