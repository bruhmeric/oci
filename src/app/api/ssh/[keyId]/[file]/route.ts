import { NextRequest } from "next/server";
import { hunterStore } from "@/lib/hunter/store";

export const runtime = "nodejs";

/** GET /api/ssh/<keyId>/<private|public> — download the keypair files. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ keyId: string; file: string }> }) {
  const { keyId, file } = await params;
  const pair = hunterStore.getKeyPair(keyId);
  if (!pair) {
    return Response.json({ ok: false, message: "Key not found (server may have restarted)." }, { status: 404 });
  }

  const shortId = keyId.slice(0, 8);
  if (file === "private") {
    return new Response(pair.privateKeyPem, {
      headers: {
        "content-type": "application/x-pem-file",
        "content-disposition": `attachment; filename="oci-hunter-${shortId}.pem"`,
      },
    });
  }
  if (file === "public") {
    return new Response(pair.publicKey + "\n", {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="oci-hunter-${shortId}.pub"`,
      },
    });
  }
  return Response.json({ ok: false, message: "file must be 'private' or 'public'." }, { status: 400 });
}
