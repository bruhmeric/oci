"use client";

import { Download, FileKey2, KeySquare, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton, Spinner, StepHeader } from "./bits";

export interface GeneratedKey {
  keyId: string;
  publicKey: string;
  privateKeyPem: string;
  fingerprint: string;
}

interface Props {
  mode: "generate" | "custom";
  onModeChange: (m: "generate" | "custom") => void;
  keyPair: GeneratedKey | null;
  generating: boolean;
  onGenerate: () => void;
  customKey: string;
  onCustomKeyChange: (v: string) => void;
  locked: boolean;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SshCard({ mode, onModeChange, keyPair, generating, onGenerate, customKey, onCustomKeyChange, locked }: Props) {
  const shortId = keyPair?.keyId.slice(0, 8);
  const customValid = customKey.trim().startsWith("ssh-") && customKey.trim().length > 60;
  const done = mode === "generate" ? !!keyPair : customValid;

  return (
    <section className="rounded-xl border border-zinc-800/80 bg-card/60 p-5 sm:p-6" aria-labelledby="step2">
      <StepHeader
        step={2}
        title="SSH Access Key"
        icon={<KeySquare className="size-4 text-emerald-400" />}
        done={done}
        right={
          <div className="flex rounded-lg border border-zinc-700/70 bg-zinc-900/60 p-0.5 text-[11px]">
            <button
              type="button"
              disabled={locked}
              onClick={() => onModeChange("generate")}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors disabled:opacity-50 ${
                mode === "generate" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Generate fresh
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => onModeChange("custom")}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors disabled:opacity-50 ${
                mode === "custom" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Use my own
            </button>
          </div>
        }
      />

      {mode === "generate" ? (
        <div className="mt-5 space-y-4">
          {!keyPair ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-zinc-700/70 bg-zinc-900/40 p-6 text-center">
              <FileKey2 className="size-8 text-zinc-600" />
              <p className="max-w-sm text-xs leading-relaxed text-zinc-400">
                Generates a 4096-bit RSA keypair on this server. The public half is injected into every launched
                instance; the private half is downloadable once below.
              </p>
              <Button
                type="button"
                onClick={onGenerate}
                disabled={generating || locked}
                className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500"
              >
                {generating ? <Spinner className="text-white" /> : <KeySquare className="size-4" />}
                {generating ? "Generating 4096-bit RSA key…" : "Generate Keypair"}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/8 p-3">
                <span className="rounded bg-zinc-900/70 px-2 py-1 font-mono text-[11px] text-emerald-300">
                  {keyPair.fingerprint}
                </span>
                <span className="text-[11px] text-zinc-400">SHA256 fingerprint of your new public key</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-400">Public key (injected into instances)</Label>
                  <CopyButton text={keyPair.publicKey} />
                </div>
                <Textarea
                  readOnly
                  value={keyPair.publicKey}
                  className="min-h-16 resize-none border-zinc-700/70 bg-zinc-900/70 font-mono text-[11px] leading-relaxed text-zinc-400"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-amber-500/40 text-xs text-amber-300 hover:bg-amber-500/10"
                  onClick={() => downloadText(`oci-hunter-${shortId}.pem`, keyPair.privateKeyPem)}
                >
                  <Download className="size-3.5" /> Private key (.pem)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-zinc-700 text-xs text-zinc-300"
                  onClick={() => downloadText(`oci-hunter-${shortId}.pub`, keyPair.publicKey + "\n")}
                >
                  <Download className="size-3.5" /> Public key (.pub)
                </Button>
              </div>
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/8 p-2.5 text-[11px] leading-relaxed text-amber-200/90">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                Download the private key NOW and store it safely — then run <code className="rounded bg-zinc-900/70 px-1">chmod 400 *.pem</code>.
                This is the only way to SSH into your instances.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          <Label htmlFor="pubkey" className="text-xs text-zinc-400">
            Your public key (authorized_keys format)
          </Label>
          <Textarea
            id="pubkey"
            value={customKey}
            onChange={(e) => onCustomKeyChange(e.target.value)}
            placeholder="ssh-rsa AAAAB3Nza… you@machine   ·   or   ssh-ed25519 AAAA…"
            className="min-h-20 border-zinc-700/70 bg-zinc-900/70 font-mono text-[11px]"
            spellCheck={false}
            disabled={locked}
          />
          <p className="text-[11px] text-zinc-500">
            {customKey.trim() === ""
              ? "Paste the contents of your ~/.ssh/id_rsa.pub or id_ed25519.pub."
              : customValid
                ? "Looks like a valid public key ✓"
                : "That doesn't look like a public key yet — it should start with ssh-rsa or ssh-ed25519."}
          </p>
        </div>
      )}
    </section>
  );
}
