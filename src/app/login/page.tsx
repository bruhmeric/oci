"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Crosshair, KeyRound, Lock, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/hunter/bits";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.ok) {
        const next = params.get("next");
        router.replace(next && next.startsWith("/") ? next : "/");
        router.refresh();
      } else {
        setError(data.message ?? "Login failed.");
      }
    } catch {
      setError("Could not reach the server — is it running?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border border-zinc-800/80 bg-card/60 p-6 shadow-2xl backdrop-blur"
    >
      <label className="block space-y-1.5">
        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Lock className="size-3.5" /> Access password
        </span>
        <Input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••••••"
          className="h-11 border-zinc-700/70 bg-zinc-900/70 text-sm"
          disabled={busy}
        />
      </label>

      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" /> {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={!password || busy}
        className="h-11 w-full gap-2 bg-emerald-600 text-white shadow-[0_0_20px_rgba(16,185,129,0.25)] hover:bg-emerald-500"
      >
        {busy ? <Spinner className="text-white" /> : <KeyRound className="size-4" />}
        {busy ? "Checking…" : "Unlock"}
      </Button>

      <p className="text-center text-[11px] leading-relaxed text-zinc-600">
        5 wrong attempts = 10-minute lockout.
        <br />
        The password lives in <code className="rounded bg-zinc-900/70 px-1 font-mono">.env</code> (SITE_PASSWORD) on the server.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="hunter-page flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-500/10">
            <Crosshair className="size-7 text-emerald-400" />
          </div>
          <h1 className="mt-4 text-lg font-bold tracking-widest text-zinc-100">OCI FREE-TIER HUNTER</h1>
          <p className="mt-1 text-xs text-zinc-500">This site is password protected.</p>
        </div>

        <Suspense
          fallback={
            <div className="flex h-56 items-center justify-center rounded-xl border border-zinc-800/80 bg-card/60">
              <Spinner />
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
