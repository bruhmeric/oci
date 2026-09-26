import { NextRequest } from "next/server";
import { oci, ociFingerprintForPrivateKey, type OciCredentials } from "@/lib/oci/client";
import { classifyOciError, describeOciError, hintForKind } from "@/lib/oci/errors";
import { hunterStore } from "@/lib/hunter/store";

export const runtime = "nodejs";

interface ValidateBody {
  credentials?: OciCredentials;
  compartmentOcid?: string;
  /** Job id whose server-stored private key to use when none is pasted. */
  reuseCredentialsFrom?: string;
}

export async function POST(req: NextRequest) {
  let body: ValidateBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, kind: "bad-request", message: "Invalid JSON body." }, { status: 400 });
  }

  const c = body.credentials;
  if (!c?.tenancyOcid || !c?.userOcid || !c?.fingerprint || !c?.region) {
    return Response.json(
      { ok: false, kind: "bad-request", message: "tenancyOcid, userOcid, fingerprint and region are all required." },
      { status: 400 }
    );
  }
  if (!c.tenancyOcid.startsWith("ocid1.") || !c.userOcid.startsWith("ocid1.")) {
    return Response.json(
      { ok: false, kind: "bad-request", message: "Tenancy OCID and User OCID must look like ocid1.tenancy.oc1..xxx / ocid1.user.oc1..xxx" },
      { status: 400 }
    );
  }

  // The private key may live server-side (restored from a previous hunt).
  const resolved = hunterStore.reuseStoredPrivateKey(body.reuseCredentialsFrom, {
    tenancyOcid: c.tenancyOcid,
    userOcid: c.userOcid,
    fingerprint: c.fingerprint,
    region: c.region,
    privateKeyPem: c.privateKeyPem ?? "",
  });
  if (!resolved.ok || !resolved.credentials) {
    return Response.json({ ok: false, kind: "bad-request", message: resolved.message ?? "Private key is missing." }, { status: 400 });
  }
  const creds = resolved.credentials;

  /* Cross-check the fingerprint against the key BEFORE calling OCI: catches
     the most common NotAuthenticated cause instantly. */
  let keyFingerprint: string;
  try {
    keyFingerprint = ociFingerprintForPrivateKey(creds.privateKeyPem);
  } catch {
    return Response.json({
      ok: false,
      kind: "auth",
      message: "The private key could not be parsed — it is not a valid RSA/EC PEM key.",
      hint: "Re-download or re-copy the .pem file and paste it again, including the BEGIN/END lines. Or use “Load .pem file” to pick it directly.",
    });
  }
  const normalized = (s: string) => s.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (normalized(keyFingerprint) !== normalized(creds.fingerprint)) {
    return Response.json({
      ok: false,
      kind: "auth",
      message: `Fingerprint mismatch: the key you pasted has fingerprint ${keyFingerprint}, but you entered ${c.fingerprint}.`,
      hint: "The fingerprint must be the one shown next to THIS key in the OCI Console (Profile → User Settings → API Keys). If you re-generated the key pair, re-copy the new fingerprint — or just replace the fingerprint field with the one above.",
    });
  }

  const compartment = body.compartmentOcid?.trim() || creds.tenancyOcid;

  try {
    const ads = await oci.listAvailabilityDomains(creds, compartment);
    return Response.json({
      ok: true,
      compartment,
      ads: (ads ?? []).map((a) => ({ name: a.name, id: a.id })),
    });
  } catch (e) {
    const kind = classifyOciError(e);
    return Response.json(
      {
        ok: false,
        kind,
        message: describeOciError(e),
        hint: hintForKind(kind, creds.region),
      },
      { status: 200 }
    );
  }
}
