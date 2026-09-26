"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Crosshair, Play, CheckCircle2, Circle, Github, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CredentialsCard, type ConnState, type Creds } from "@/components/hunter/credentials-card";
import { SshCard, type GeneratedKey } from "@/components/hunter/ssh-card";
import { SpecCard, type ImageInfo, type Spec } from "@/components/hunter/spec-card";
import { NetworkCard, type NetworkCfg, type VcnWithSubnets } from "@/components/hunter/network-card";
import { TelegramCard } from "@/components/hunter/telegram-card";
import { HuntDashboard } from "@/components/hunter/hunt-dashboard";
import type { HuntJobSnapshot } from "@/lib/hunter/types";
import { cn } from "@/lib/utils";

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1318.5, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
    setTimeout(() => void ctx.close(), 900);
  } catch {
    /* audio not available — silently skip */
  }
}

export default function Home() {
  /* ------------------------------ state ------------------------------ */
  const [creds, setCreds] = useState<Creds>({
    tenancyOcid: "",
    userOcid: "",
    fingerprint: "",
    privateKeyPem: "",
    region: "ap-singapore-2",
    compartmentOcid: "",
  });
  const [connState, setConnState] = useState<ConnState>({ status: "idle" });

  const [sshMode, setSshMode] = useState<"generate" | "custom">("generate");
  const [keyPair, setKeyPair] = useState<GeneratedKey | null>(null);
  const [generating, setGenerating] = useState(false);
  const [customKey, setCustomKey] = useState("");

  const [spec, setSpec] = useState<Spec>({
    ocpus: 2,
    memoryInGBs: 12,
    bootVolumeSizeInGBs: 50,
    imageOsId: "ubuntu-24",
    instanceCount: 1,
    namePrefix: "sg-a1-hunter",
    availabilityDomain: undefined,
  });
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);

  const [network, setNetwork] = useState<NetworkCfg>({ mode: "auto", existingVcnId: "", existingSubnetId: "" });
  const [vcns, setVcns] = useState<VcnWithSubnets[] | null>(null);
  const [loadingVcns, setLoadingVcns] = useState(false);

  const [retry, setRetry] = useState({ intervalSec: 60, jitter: true });

  const [jobId, setJobId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<HuntJobSnapshot | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  /** Job id whose API private key is stored server-side (restored form). */
  const [savedCredsFrom, setSavedCredsFrom] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());
  const prevLaunched = useRef(0);

  /* --------------------------- ticking clock -------------------------- */
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  /* --------------- restore the hunt on page load (server truth) --------
     The hunt runs on the SERVER — closing the browser never stops it.
     On login we fetch the job list, re-attach to any live hunt, and prefill
     the whole form from the latest job so nothing has to be re-entered. */
  const prefillFromJob = useCallback((job: HuntJobSnapshot) => {
    const c = job.config;
    setCreds((prev) => ({
      ...prev,
      tenancyOcid: c.credentials.tenancyOcid || prev.tenancyOcid,
      userOcid: c.credentials.userOcid || prev.userOcid,
      fingerprint: c.credentials.fingerprint || prev.fingerprint,
      region: c.credentials.region || prev.region,
      compartmentOcid: c.compartmentOcid || prev.compartmentOcid,
      privateKeyPem: "", // never leaves the server — paste a new one only to replace it
    }));
    setSavedCredsFrom(c.credentials.tenancyOcid ? job.id : null);
    setSpec((prev) => ({
      ...prev,
      ocpus: c.ocpus,
      memoryInGBs: c.memoryInGBs,
      bootVolumeSizeInGBs: c.bootVolumeSizeInGBs,
      imageOsId: c.imageOsId,
      instanceCount: c.instanceCount,
      namePrefix: c.namePrefix,
      availabilityDomain: c.availabilityDomain ?? prev.availabilityDomain,
    }));
    setRetry({ intervalSec: c.retryIntervalSec, jitter: c.jitter });
    // Reuse the subnet the hunt built/used → new hunts don't stack up VCNs.
    const subnet = c.networkMode === "existing" ? c.existingSubnetId : job.network?.subnetId;
    if (subnet) setNetwork({ mode: "existing", existingVcnId: job.network?.vcnId ?? "", existingSubnetId: subnet });
    if (c.sshPublicKey) {
      setSshMode("custom");
      setCustomKey(c.sshPublicKey);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/hunt");
        const data = await res.json();
        if (!data.ok || !data.jobs?.length) return;
        const lastId = localStorage.getItem("hunter.lastJobId");
        const isLive = (j: HuntJobSnapshot) => j.status === "starting" || j.status === "running";
        const target: HuntJobSnapshot | undefined =
          data.jobs.find(isLive) ?? data.jobs.find((j: HuntJobSnapshot) => j.id === lastId) ?? data.jobs[0];
        if (!target) return;
        // The list trims logs — pull the full snapshot for the console.
        const full = await fetch(`/api/hunt/${target.id}`).then((r) => r.json()).catch(() => null);
        const job: HuntJobSnapshot = full?.ok ? full.job : target;
        setJobId(job.id);
        setSnapshot(job);
        localStorage.setItem("hunter.lastJobId", job.id);
        prefillFromJob(job);
        if (isLive(job)) {
          toast.success(`Hunt #${job.id} is still running — it never stopped. Welcome back!`);
          setTimeout(() => document.getElementById("dashboard")?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
        }
      } catch {
        /* server waking up — the polling effect takes over once jobId is known */
      }
    })();
  }, [prefillFromJob]);

  /* ------------------------- hunt status polling ----------------------- */
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/hunt/${jobId}`);
        const data = await res.json();
        if (!alive) return;
        if (data.ok) {
          setSnapshot(data.job as HuntJobSnapshot);
          const j = data.job as HuntJobSnapshot;
          const busy =
            j.status === "starting" ||
            j.status === "running" ||
            j.slots.some((s) => (s.status === "launched" || s.status === "running") && !s.instance?.publicIp);
          if (busy) timer = setTimeout(poll, 2000);
        }
      } catch {
        if (alive) timer = setTimeout(poll, 4000);
      }
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [jobId]);

  /* --------------------------- success beep ---------------------------- */
  useEffect(() => {
    if (!snapshot) return;
    const launched = snapshot.slots.filter((s) => s.status === "launched" || s.status === "running").length;
    if (launched > prevLaunched.current) {
      if (soundOn) beep();
      toast.success(`${launched} instance${launched > 1 ? "s" : ""} secured! 🎯`);
    }
    prevLaunched.current = launched;
  }, [snapshot, soundOn]);

  /* ------------------------------ handlers ----------------------------- */

  const patchCreds = useCallback((patch: Partial<Creds>) => {
    setCreds((c) => ({ ...c, ...patch }));
    setConnState((s) => (s.status === "idle" ? s : { status: "idle" }));
  }, []);

  const jsonFetch = (url: string, body: unknown) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const credentialsPayload = () => ({
    tenancyOcid: creds.tenancyOcid.trim(),
    userOcid: creds.userOcid.trim(),
    fingerprint: creds.fingerprint.trim(),
    privateKeyPem: creds.privateKeyPem.trim(),
    region: creds.region,
    // When no PEM is pasted, the server swaps in the key it stored for that hunt.
    ...(creds.privateKeyPem.trim() ? {} : savedCredsFrom ? { reuseCredentialsFrom: savedCredsFrom } : {}),
  });

  const handleValidate = async () => {
    setConnState({ status: "checking" });
    const failsafe = setTimeout(
      () =>
        setConnState((s) =>
          s.status === "checking"
            ? { status: "error", message: "Validation timed out", hint: "No response within 45s — check your connection and press Validate again." }
            : s
        ),
      45000
    );
    try {
      const res = await jsonFetch("/api/oci/validate", {
        credentials: credentialsPayload(),
        compartmentOcid: creds.compartmentOcid.trim(),
      });
      const data = await res.json();
      if (data.ok) {
        setConnState({ status: "ok", ads: data.ads, compartment: data.compartment });
        setSpec((s) => ({ ...s, availabilityDomain: s.availabilityDomain ?? data.ads?.[0]?.name }));
        toast.success(`Authenticated — ${data.ads?.length ?? 0} availability domain(s) discovered`);
      } else {
        setConnState({ status: "error", message: data.message, hint: data.hint });
        toast.error("Validation failed — see details in Step 1");
      }
    } catch {
      setConnState({ status: "error", message: "Could not reach the local server. Is it still running?" });
    } finally {
      clearTimeout(failsafe);
    }
  };

  const handleGenerateKey = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/ssh/generate", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setKeyPair({ keyId: data.keyId, publicKey: data.publicKey, privateKeyPem: data.privateKeyPem, fingerprint: data.fingerprint });
        toast.success("4096-bit RSA keypair generated — download the private key below!");
      } else {
        toast.error(data.message ?? "Key generation failed");
      }
    } catch {
      toast.error("Key generation failed — is the server running?");
    } finally {
      setGenerating(false);
    }
  };

  /* resolve the newest image whenever the OS choice changes */
  useEffect(() => {
    if (connState.status !== "ok" || !spec.imageOsId) return;
    let alive = true;
    setImageInfo({ loading: true, sshUser: "", images: [] });
    (async () => {
      try {
        const res = await jsonFetch("/api/oci/images", {
          credentials: credentialsPayload(),
          compartmentOcid: creds.compartmentOcid.trim(),
          imageOsId: spec.imageOsId,
        });
        const data = await res.json();
        if (!alive) return;
        if (data.ok) setImageInfo({ loading: false, sshUser: data.sshUser, images: data.images ?? [] });
        else setImageInfo(null);
      } catch {
        if (alive) setImageInfo(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [connState.status, spec.imageOsId]);

  const refreshNetworks = async () => {
    setLoadingVcns(true);
    try {
      const res = await jsonFetch("/api/oci/networks", {
        credentials: credentialsPayload(),
        compartmentOcid: creds.compartmentOcid.trim(),
      });
      const data = await res.json();
      if (data.ok) {
        setVcns(data.vcns);
        if (!data.vcns?.length) toast.info("No VCNs found — the auto-build option will create one for you.");
      } else {
        toast.error(data.message ?? "Could not list networks");
      }
    } catch {
      toast.error("Network listing failed");
    } finally {
      setLoadingVcns(false);
    }
  };

  const huntLive = !!snapshot && (snapshot.status === "starting" || snapshot.status === "running");
  const sshReady = sshMode === "generate" ? !!keyPair : customKey.trim().startsWith("ssh-") && customKey.trim().length > 60;
  const networkReady = network.mode === "auto" || !!network.existingSubnetId;

  const handleStart = async () => {
    setStarting(true);
    try {
      const res = await jsonFetch("/api/hunt", {
        credentials: credentialsPayload(),
        compartmentOcid: creds.compartmentOcid.trim(),
        ocpus: spec.ocpus,
        memoryInGBs: spec.memoryInGBs,
        bootVolumeSizeInGBs: spec.bootVolumeSizeInGBs,
        imageOsId: spec.imageOsId,
        instanceCount: spec.instanceCount,
        namePrefix: spec.namePrefix.trim() || "oci-hunter",
        networkMode: network.mode,
        existingSubnetId: network.mode === "existing" ? network.existingSubnetId : undefined,
        retryIntervalSec: retry.intervalSec,
        jitter: retry.jitter,
        sshPublicKey: sshMode === "generate" ? keyPair!.publicKey : customKey.trim(),
        sshKeyId: sshMode === "generate" ? keyPair!.keyId : undefined,
        availabilityDomain: spec.availabilityDomain,
      });
      const data = await res.json();
      if (!data.ok) {
        toast.error(data.message ?? "Could not start the hunt");
        return;
      }
      setJobId(data.jobId);
      setSnapshot(data.job as HuntJobSnapshot);
      localStorage.setItem("hunter.lastJobId", data.jobId);
      toast.success(`Hunt #${data.jobId} is live — the hunt begins. Hold the line!`);
      setTimeout(() => document.getElementById("dashboard")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    } catch {
      toast.error("Could not start the hunt — is the server awake?");
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!jobId) return;
    setStopping(true);
    try {
      await fetch(`/api/hunt/${jobId}/stop`, { method: "POST" });
      toast.info("Stop requested — finishing the current attempt, then halting.");
    } catch {
      toast.error("Stop request failed");
    } finally {
      setStopping(false);
    }
  };

  const handleResume = async () => {
    if (!jobId) return;
    setResuming(true);
    try {
      const res = await fetch(`/api/hunt/${jobId}/resume`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setSnapshot(data.job as HuntJobSnapshot);
        toast.success(`Hunt #${jobId} resumed — back to holding the line.`);
      } else {
        toast.error(data.message ?? "Could not resume the hunt");
      }
    } catch {
      toast.error("Resume request failed");
    } finally {
      setResuming(false);
    }
  };

  /* -------------------------------- render ------------------------------ */

  const restoredCredsOk =
    !!savedCredsFrom &&
    creds.tenancyOcid.startsWith("ocid1.tenancy.") &&
    creds.userOcid.startsWith("ocid1.user.") &&
    creds.fingerprint.replace(/[^0-9a-fA-F]/g, "").length === 32 &&
    !!creds.region;
  const checklist = [
    { ok: connState.status === "ok" || restoredCredsOk, label: restoredCredsOk && connState.status !== "ok" ? "credentials restored (key stored server-side)" : "credentials validated" },
    { ok: sshReady, label: "SSH key ready" },
    { ok: networkReady, label: "network mode chosen" },
    { ok: !huntLive, label: huntLive ? "hunt already running" : "no active hunt" },
  ];
  const allReady = checklist.every((c) => c.ok);

  return (
    <div className="hunter-page flex min-h-screen flex-col">
      {/* ------------------------------- header ------------------------------ */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/70 bg-zinc-950/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex size-9 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/10">
            <Crosshair className={cn("size-5 text-emerald-400", huntLive && "animate-hunter-pulse")} />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-widest text-zinc-100">OCI FREE-TIER HUNTER</h1>
            <p className="text-[11px] text-zinc-500">Ampere A1 capacity sniper · keeps retrying until Oracle says yes</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] text-emerald-300 sm:inline">
              {creds.region}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                huntLive
                  ? "border-orange-500/40 bg-orange-500/10 text-orange-300"
                  : snapshot?.status === "completed"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-zinc-700 bg-zinc-800/50 text-zinc-400"
              )}
            >
              <span className={cn("size-1.5 rounded-full", huntLive ? "bg-orange-400 animate-hunter-pulse" : "bg-zinc-500")} />
              {huntLive ? "hunting" : snapshot?.status === "completed" ? "target secured" : "standby"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Log out"
              aria-label="Log out"
              className="size-8 rounded-lg text-zinc-500 hover:bg-red-500/10 hover:text-red-300"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
                window.location.href = "/login";
              }}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* -------------------------------- main ------------------------------- */}
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-5 px-4 py-8 sm:px-6">
        <div className="space-y-5">
          <CredentialsCard
            creds={creds}
            onChange={patchCreds}
            connState={connState}
            onValidate={handleValidate}
            locked={huntLive}
            savedKeyFrom={savedCredsFrom}
          />
          <SshCard
            mode={sshMode}
            onModeChange={setSshMode}
            keyPair={keyPair}
            generating={generating}
            onGenerate={handleGenerateKey}
            customKey={customKey}
            onCustomKeyChange={setCustomKey}
            locked={huntLive}
          />
          <SpecCard spec={spec} onChange={(p) => setSpec((s) => ({ ...s, ...p }))} ads={connState.ads ?? []} imageInfo={imageInfo} locked={huntLive} />
          <NetworkCard
            network={network}
            onChange={(p) => setNetwork((n) => ({ ...n, ...p }))}
            vcns={vcns}
            loadingVcns={loadingVcns}
            onRefreshNetworks={refreshNetworks}
            retry={retry}
            onRetryChange={(p) => setRetry((r) => ({ ...r, ...p }))}
            locked={huntLive}
            canQuery={connState.status === "ok"}
          />
          <TelegramCard locked={huntLive} />
        </div>

        {/* --------------------------- launch panel --------------------------- */}
        <section className="rounded-xl border border-zinc-800/80 bg-card/60 p-5 sm:p-6">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <Button
              type="button"
              size="lg"
              disabled={!allReady || starting}
              onClick={handleStart}
              className={cn(
                "h-12 gap-2 px-8 text-base font-bold tracking-wide",
                allReady
                  ? "bg-emerald-600 text-white shadow-[0_0_30px_rgba(16,185,129,0.35)] hover:bg-emerald-500"
                  : "bg-zinc-800 text-zinc-500"
              )}
            >
              <Play className="size-5" />
              {starting ? "STARTING…" : huntLive ? "HUNT IN PROGRESS" : "START HUNTING"}
            </Button>
            <ul className="grid flex-1 grid-cols-1 gap-1 text-[11px] text-zinc-500 sm:grid-cols-2">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-center gap-1.5">
                  {c.ok ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <Circle className="size-3.5 text-zinc-600" />}
                  <span className={c.ok ? "text-zinc-400" : ""}>{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
            Keeps calling <code className="rounded bg-zinc-900/70 px-1 font-mono">LaunchInstance</code> every {retry.intervalSec}s
            per slot until capacity appears (“Out of host capacity” is retried forever), then provisions{" "}
            {spec.instanceCount} × VM.Standard.A1.Flex ({spec.ocpus} OCPU / {spec.memoryInGBs} GB), builds a fresh VCN with
            new VNICs + public IPs, and hands you the SSH command. The hunt runs on the <b className="text-zinc-300">server</b> —
            close this page any time and log back in to see the same live console. Even a server restart auto-resumes the hunt
            with its attempt counters preserved.
          </p>
        </section>

        {/* ---------------------------- dashboard ----------------------------- */}
        <section id="dashboard" className="scroll-mt-20" aria-label="Hunt dashboard">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-bold tracking-widest text-zinc-300">HUNT CONSOLE</h2>
            <div className="h-px flex-1 bg-gradient-to-r from-emerald-500/40 to-transparent" />
          </div>
          <HuntDashboard
            job={snapshot}
            now={now}
            onStop={handleStop}
            stopping={stopping}
            onResume={handleResume}
            resuming={resuming}
            soundOn={soundOn}
            onToggleSound={() => setSoundOn((v) => !v)}
            keyDownloads={snapshot ? { keyId: snapshot.config.sshKeyId ?? "" } : null}
          />
        </section>
      </main>

      {/* ------------------------------- footer ------------------------------ */}
      <footer className="mt-auto border-t border-zinc-800/70 bg-zinc-950/60">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 text-[11px] text-zinc-600 sm:px-6">
          <span>Runs locally · your OCI key only signs API calls to {creds.region}</span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <Github className="size-3.5" /> Always Free A1 allowance: 4 OCPU · 24 GB RAM · 200 GB boot volume per month
          </span>
        </div>
      </footer>
    </div>
  );
}
