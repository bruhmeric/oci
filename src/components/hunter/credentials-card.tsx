"use client";

import { useMemo, useRef } from "react";
import { toast } from "sonner";
import { Check, Cloud, KeyRound, ShieldCheck, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { OCI_REGIONS } from "@/lib/hunter/types";
import { Spinner, StepHeader } from "./bits";
import { cn } from "@/lib/utils";

export interface Creds {
  tenancyOcid: string;
  userOcid: string;
  fingerprint: string;
  privateKeyPem: string;
  region: string;
  compartmentOcid: string;
}

export interface ConnState {
  status: "idle" | "checking" | "ok" | "error";
  message?: string;
  hint?: string;
  ads?: string[];
  compartment?: string;
}

interface Props {
  creds: Creds;
  onChange: (patch: Partial<Creds>) => void;
  connState: ConnState;
  onValidate: () => void;
  locked: boolean;
  /** Job id whose private key is stored server-side (restored form) — suppresses the “paste key” requirement. */
  savedKeyFrom?: string | null;
}

function looksLikeOcid(v: string, type: string) {
  return v.trim().startsWith(`ocid1.${type}.`);
}

/** Keys copied from JSON / env vars / chat messages often carry literal \n escapes — undo them. */
function normalizePemPaste(v: string): string {
  if (v.includes("\\n")) return v.replace(/\\r\\n|\\n/g, "\n");
  return v;
}

function hexCount(v: string) {
  return v.replace(/[^0-9a-fA-F]/g, "").length;
}

/** Small live status dot next to each required label. */
function FieldOk({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-full transition-colors",
        ok ? "text-emerald-400" : "text-zinc-700"
      )}
    >
      {ok ? <Check className="size-3.5" strokeWidth={3} /> : <span className="size-1.5 rounded-full bg-current" />}
    </span>
  );
}

export function CredentialsCard({ creds, onChange, connState, onValidate, locked, savedKeyFrom }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  // A restored form carries no PEM in the browser — the server holds the key.
  const usingSavedKey = !!savedKeyFrom && !creds.privateKeyPem.trim();

  const normalizeFingerprint = () => {
    const raw = creds.fingerprint.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
    if (raw.length === 32 && !creds.fingerprint.includes(":")) {
      onChange({ fingerprint: raw.replace(/(..)(?=.)/g, "$1:") });
    }
  };

  const tenancyOk = looksLikeOcid(creds.tenancyOcid, "tenancy");
  const userOk = looksLikeOcid(creds.userOcid, "user");
  // OCI API key fingerprints are MD5-based: 32 hex chars, shown as 16 colon-separated pairs.
  const fpOk = hexCount(creds.fingerprint) === 32;
  const keyOk = useMemo(() => {
    const v = normalizePemPaste(creds.privateKeyPem).trim();
    return /BEGIN[A-Z0-9 ]*(PRIVATE|RSA) KEY/.test(v) && v.length > 100;
  }, [creds.privateKeyPem]);
  const regionOk = !!creds.region;

  const missing: string[] = [];
  if (!tenancyOk) missing.push("Tenancy OCID");
  if (!userOk) missing.push("User OCID");
  if (!fpOk) missing.push("API key fingerprint");
  if (!keyOk && !usingSavedKey) missing.push("Private key (with BEGIN/END lines)");
  if (!regionOk) missing.push("Home region");

  const busy = connState.status === "checking";

  const handleValidateClick = () => {
    if (missing.length > 0) {
      toast.error(`Still missing: ${missing.join(" · ")}`, {
        description: "Fill in the highlighted fields in Step 1, then try again.",
      });
      return;
    }
    onValidate();
  };

  const pemPlaceholder = useMemo(
    () => ["-----" + "BEGIN PRIVATE KEY" + "-----", "MIIEvQIBADANBg… (paste the FULL key — every line)", "-----END PRIVATE KEY-----"].join("\n"),
    []
  );

  return (
    <section className="rounded-xl border border-zinc-800/80 bg-card/60 p-5 sm:p-6" aria-labelledby="step1">
      <StepHeader
        step={1}
        title="OCI API Credentials"
        icon={<Cloud className="size-4 text-emerald-400" />}
        done={connState.status === "ok"}
        right={
          connState.status === "ok" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
              <ShieldCheck className="size-3" /> Authenticated
            </span>
          ) : null
        }
      />

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="tenancy" className="text-xs text-zinc-400">
              Tenancy OCID <span className="text-red-400">*</span>
            </Label>
            <FieldOk ok={tenancyOk} />
          </div>
          <Input
            id="tenancy"
            value={creds.tenancyOcid}
            onChange={(e) => onChange({ tenancyOcid: e.target.value.trim() })}
            placeholder="ocid1.tenancy.oc1..aaaa…"
            className="border-zinc-700/70 bg-zinc-900/70 font-mono text-xs"
            spellCheck={false}
            autoComplete="off"
            disabled={locked}
            aria-invalid={creds.tenancyOcid.length > 5 && !tenancyOk}
          />
          {creds.tenancyOcid.length > 5 && !tenancyOk && (
            <p className="text-[11px] text-amber-300/80">Should start with “ocid1.tenancy.” — copy it from OCI Console → Profile → Tenancy.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="user" className="text-xs text-zinc-400">
              User OCID <span className="text-red-400">*</span>
            </Label>
            <FieldOk ok={userOk} />
          </div>
          <Input
            id="user"
            value={creds.userOcid}
            onChange={(e) => onChange({ userOcid: e.target.value.trim() })}
            placeholder="ocid1.user.oc1..aaaa…"
            className="border-zinc-700/70 bg-zinc-900/70 font-mono text-xs"
            spellCheck={false}
            autoComplete="off"
            disabled={locked}
            aria-invalid={creds.userOcid.length > 5 && !userOk}
          />
          {creds.userOcid.length > 5 && !userOk && (
            <p className="text-[11px] text-amber-300/80">Should start with “ocid1.user.” — copy it from Profile → User Settings.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="fingerprint" className="text-xs text-zinc-400">
              API Key Fingerprint <span className="text-red-400">*</span>
            </Label>
            <FieldOk ok={fpOk} />
          </div>
          <Input
            id="fingerprint"
            value={creds.fingerprint}
            onChange={(e) => onChange({ fingerprint: e.target.value.trim() })}
            onBlur={normalizeFingerprint}
            placeholder="aa:bb:cc:…:zz (colons auto-added)"
            className="border-zinc-700/70 bg-zinc-900/70 font-mono text-xs"
            spellCheck={false}
            autoComplete="off"
            disabled={locked}
            aria-invalid={creds.fingerprint.length > 4 && !fpOk}
          />
          {creds.fingerprint.length > 4 && !fpOk && (
            <p className="text-[11px] text-amber-300/80">
              {hexCount(creds.fingerprint) === 64
                ? "That looks like a SHA-256 fingerprint (64 chars) — the API key fingerprint is the shorter 32-char one shown in the console (Profile → User Settings → API Keys)."
                : "Needs 32 hex chars (16 pairs like dc:fa:d1:…) — copy it from Profile → User Settings → API Keys, right where you added the key."}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="region" className="text-xs text-zinc-400">
              Home Region <span className="text-red-400">*</span>{" "}
              <span className="text-zinc-500">— where your tenancy is homed, not the closest one</span>
            </Label>
            <FieldOk ok={regionOk} />
          </div>
          <Select value={creds.region} onValueChange={(v) => onChange({ region: v })} disabled={locked}>
            <SelectTrigger id="region" className="w-full border-zinc-700/70 bg-zinc-900/70 text-xs">
              <SelectValue placeholder="Select region" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {OCI_REGIONS.map((r) => (
                <SelectItem key={r.id} value={r.id} className="text-xs">
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="compartment" className="text-xs text-zinc-400">
            Compartment OCID <span className="text-zinc-500">(optional — empty = tenancy root)</span>
          </Label>
          <Input
            id="compartment"
            value={creds.compartmentOcid}
            onChange={(e) => onChange({ compartmentOcid: e.target.value.trim() })}
            placeholder="ocid1.compartment.oc1..aaaa…"
            className="border-zinc-700/70 bg-zinc-900/70 font-mono text-xs"
            spellCheck={false}
            autoComplete="off"
            disabled={locked}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="pem" className="text-xs text-zinc-400">
              API Signing Private Key (.pem){!usingSavedKey && <span className="text-red-400"> *</span>}
            </Label>
            <FieldOk ok={keyOk || usingSavedKey} />
          </div>
          {usingSavedKey && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-200">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Using the API key stored <b>server-side</b> from hunt <code className="font-mono">#{savedKeyFrom}</code> — nothing to re-paste.
                Paste a new key below only if you want to replace it.
              </span>
            </div>
          )}
          <Textarea
            id="pem"
            value={creds.privateKeyPem}
            onChange={(e) => onChange({ privateKeyPem: normalizePemPaste(e.target.value) })}
            placeholder={usingSavedKey ? "(optional) Paste a NEW private key here to replace the stored one…" : pemPlaceholder}
            className="min-h-24 border-zinc-700/70 bg-zinc-900/70 font-mono text-[11px] leading-relaxed"
            spellCheck={false}
            disabled={locked}
          />
          {creds.privateKeyPem.trim().length > 0 && !keyOk && (
            <p className="text-[11px] text-amber-300/80">
              That doesn’t look like a complete PEM — include the “-----BEGIN … PRIVATE KEY-----” and “-----END … PRIVATE KEY-----” lines.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 border-zinc-700 text-xs text-zinc-300"
              disabled={locked}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-3.5" /> Load .pem file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".pem,.key,text/plain"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const text = await f.text();
                onChange({ privateKeyPem: normalizePemPaste(text).trim() });
                e.target.value = "";
              }}
            />
            <span className="text-[11px] text-zinc-500">
              The key never leaves this server except to sign OCI API calls.
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={handleValidateClick}
          disabled={locked || busy}
          className={cn(
            "gap-2 text-white",
            missing.length === 0
              ? "bg-emerald-600 shadow-[0_0_20px_rgba(16,185,129,0.25)] hover:bg-emerald-500"
              : "bg-zinc-700 hover:bg-zinc-600"
          )}
        >
          {busy ? <Spinner className="text-white" /> : <KeyRound className="size-4" />}
          {busy ? "Testing connection…" : "Validate & Discover"}
        </Button>

        {!locked && !busy && missing.length > 0 && (
          <p className="text-xs text-amber-300/90">
            <span className="font-medium">Still needed:</span> {missing.join(" · ")}
          </p>
        )}
        {!locked && !busy && missing.length === 0 && connState.status !== "ok" && (
          <p className="text-xs text-zinc-500">All fields look good — run the check.</p>
        )}

        {connState.status === "ok" && (
          <p className="text-xs text-emerald-300">
            Signed OK · {connState.ads?.length ?? 0} availability domain(s)
            {connState.ads && connState.ads.length > 0 ? ` (${connState.ads.join(", ")})` : ""}
          </p>
        )}
        {connState.status === "error" && (
          <div className="flex-1 basis-full rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs">
            <div className="flex items-start gap-2 text-red-300">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <div>
                <p className="font-medium">{connState.message}</p>
                {connState.hint ? <p className="mt-1 whitespace-pre-line text-red-300/70">{connState.hint}</p> : null}
              </div>
            </div>
          </div>
        )}
      </div>

      <Collapsible className="mt-4">
        <CollapsibleTrigger className="text-[11px] font-medium text-zinc-500 underline decoration-dotted underline-offset-4 hover:text-emerald-300">
          Where do I find these values?
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[11px] leading-relaxed text-zinc-400">
            <li>OCI Console → Profile (top right) → <b>Tenancy</b> → copy the OCID (and note the <b>home region</b> shown on the same page).</li>
            <li>Profile → <b>User Settings</b> → copy your User OCID.</li>
            <li>Under <b>APIKeys</b> → <b>Add API Key</b> → “Generate API key pair” → download the <b>private</b> key (.pem) and copy the shown <b>fingerprint</b>.</li>
            <li>Paste the private key contents (BEGIN/END lines included) above, pick your <b>home</b> region — e.g. ap-singapore-2 (Singapore West) or ap-singapore-1 — and hit Validate.</li>
          </ol>
        </CollapsibleContent>
      </Collapsible>

      <p className={cn("mt-3 text-[11px] text-zinc-500", locked && "opacity-60")}>
        Important: Singapore has two regions — ap-singapore-1 and ap-singapore-2 (Singapore West). Pick the one your tenancy is homed in: check the top-right region selector in the OCI Console, or Profile → Tenancy → “Home region”. API keys only work against the home region endpoint.
      </p>
    </section>
  );
}
