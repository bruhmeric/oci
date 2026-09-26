import { NextRequest } from "next/server";
import { oci, type OciCredentials } from "@/lib/oci/client";
import { classifyOciError, describeOciError } from "@/lib/oci/errors";

export const runtime = "nodejs";

interface NetworksBody {
  credentials?: OciCredentials;
  compartmentOcid?: string;
}

export async function POST(req: NextRequest) {
  let body: NetworksBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const c = body.credentials;
  if (!c?.tenancyOcid || !c?.userOcid || !c?.fingerprint || !c?.privateKeyPem || !c?.region) {
    return Response.json({ ok: false, message: "Missing credentials." }, { status: 400 });
  }

  const compartment = body.compartmentOcid?.trim() || c.tenancyOcid;

  try {
    const vcns = (await oci.listVcns(c, compartment)) ?? [];
    const withSubnets = await Promise.all(
      vcns.slice(0, 15).map(async (v) => {
        let subnets: Array<{ id: string; displayName: string; cidrBlock: string }> = [];
        try {
          subnets = ((await oci.listSubnets(c, compartment, v.id)) ?? []).map((s) => ({
            id: s.id,
            displayName: s.displayName,
            cidrBlock: s.cidrBlock,
          }));
        } catch {
          /* a broken VCN should not break the whole listing */
        }
        return {
          id: v.id,
          displayName: v.displayName,
          cidrBlocks: v.cidrBlocks ?? [],
          subnets,
        };
      })
    );
    return Response.json({ ok: true, vcns: withSubnets });
  } catch (e) {
    return Response.json({ ok: false, kind: classifyOciError(e), message: describeOciError(e) }, { status: 200 });
  }
}
