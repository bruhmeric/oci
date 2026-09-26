import { NextRequest } from "next/server";
import { oci, type OciCredentials } from "@/lib/oci/client";
import { classifyOciError, describeOciError } from "@/lib/oci/errors";
import { IMAGE_OS_OPTIONS } from "@/lib/hunter/types";

export const runtime = "nodejs";

interface ImagesBody {
  credentials?: OciCredentials;
  compartmentOcid?: string;
  imageOsId?: string;
}

export async function POST(req: NextRequest) {
  let body: ImagesBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const c = body.credentials;
  const osOpt = IMAGE_OS_OPTIONS.find((o) => o.id === body.imageOsId) ?? IMAGE_OS_OPTIONS[0];
  if (!c?.tenancyOcid || !c?.userOcid || !c?.fingerprint || !c?.privateKeyPem || !c?.region) {
    return Response.json({ ok: false, message: "Missing credentials." }, { status: 400 });
  }

  try {
    const images = await oci.listImages(c, body.compartmentOcid?.trim() || c.tenancyOcid, {
      operatingSystem: osOpt.os,
      operatingSystemVersion: osOpt.version,
      limit: 5,
    });
    return Response.json({
      ok: true,
      sshUser: osOpt.sshUser,
      images: (images ?? []).map((i) => ({
        id: i.id,
        displayName: i.displayName,
        timeCreated: i.timeCreated,
        sizeInGBs: i.sizeInMBs ? Math.round(i.sizeInMBs / 1024) : undefined,
      })),
    });
  } catch (e) {
    return Response.json({ ok: false, kind: classifyOciError(e), message: describeOciError(e) }, { status: 200 });
  }
}
