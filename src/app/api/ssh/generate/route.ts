import { hunterStore } from "@/lib/hunter/store";
import { generateSshKeyPair } from "@/lib/hunter/ssh";

export const runtime = "nodejs";

export async function POST() {
  try {
    const pair = generateSshKeyPair();
    hunterStore.saveKeyPair(pair);
    return Response.json({
      ok: true,
      keyId: pair.keyId,
      publicKey: pair.publicKey,
      privateKeyPem: pair.privateKeyPem,
      fingerprint: pair.fingerprint,
      createdAt: pair.createdAt,
    });
  } catch (e) {
    return Response.json({ ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
