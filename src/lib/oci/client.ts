/**
 * Lightweight OCI REST client with manual API-request signing.
 *
 * Implements the Oracle Cloud "Signature version 1" authentication scheme:
 *   Authorization: Signature version="1",keyId="<tenancy>/<user>/<fingerprint>",
 *                  algorithm="rsa-sha256",headers="...",signature="base64(...)"
 *
 * Signed headers: date, (request-target), host  (+ x-content-sha256,
 * content-type, content-length for requests with a body).
 *
 * Uses node:https directly (not fetch) so Host / Content-Length headers
 * can be set explicitly, as required by OCI signature verification.
 */
import crypto from "node:crypto";
import https from "node:https";
import type { OciError } from "./errors";

export const A1_SHAPE = "VM.Standard.A1.Flex";

export interface OciCredentials {
  tenancyOcid: string;
  userOcid: string;
  fingerprint: string;
  privateKeyPem: string;
  region: string;
}

export interface OciRequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  timeoutMs?: number;
}

/** Accepts sloppy pasted PEM: escaped newlines, single-line, CRLF. */
export function normalizePrivateKey(pem: string): string {
  let k = (pem || "").trim();
  k = k.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
  if (!k.includes("\n")) {
    // Single-line PEM — re-wrap the base64 body between the markers.
    k = k.replace(/-----BEGIN ([A-Z0-9 ]+)-----/, "-----BEGIN $1-----\n");
    k = k.replace(/-----END ([A-Z0-9 ]+)-----/, "\n-----END $1-----");
  }
  return k.trim();
}

/**
 * Computes the OCI API key fingerprint for a private key PEM — same result as
 *   openssl rsa -pubout -outform DER -in key.pem | openssl md5 -c
 * (MD5 over the DER-encoded SubjectPublicKeyInfo, formatted as 16 hex pairs).
 * Used to cross-check the user-pasted fingerprint BEFORE hitting the API.
 */
export function ociFingerprintForPrivateKey(privateKeyPem: string): string {
  const priv = crypto.createPrivateKey(normalizePrivateKey(privateKeyPem));
  const pubDer = crypto.createPublicKey(priv).export({ type: "spki", format: "der" });
  return crypto.createHash("md5").update(pubDer).digest("hex").replace(/(..)(?=.)/g, "$1:");
}

function toOciError(status: number, headers: Record<string, string | string[] | undefined>, text: string): OciError {
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  const err = new Error(parsed?.message || parsed?.code || `HTTP ${status} from OCI`) as OciError;
  err.status = status;
  err.code = parsed?.code;
  const rid = headers?.["opc-request-id"];
  err.opcRequestId = Array.isArray(rid) ? rid[0] : rid;
  return err;
}

function httpsJson(
  url: URL,
  method: string,
  headers: Record<string, string>,
  bodyStr: string | undefined,
  timeoutMs: number
): Promise<{ status: number; headers: any; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString("utf8")));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: data }));
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Request timeout while talking to OCI")));
    req.on("error", reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

/**
 * Signed request against an OCI service endpoint.
 * @param service "iaas" (compute/network/volume) or "identity"
 */
export async function ociRequest<T = any>(
  creds: OciCredentials,
  method: "GET" | "POST" | "PUT" | "DELETE",
  service: "iaas" | "identity",
  path: string,
  opts: OciRequestOptions = {}
): Promise<T> {
  const host = `${service}.${creds.region}.oraclecloud.com`;
  const url = new URL(`https://${host}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const date = new Date().toUTCString();

  const headers: Record<string, string> = {
    host,
    date,
    accept: "application/json",
    "user-agent": "oci-free-tier-hunter/1.0",
  };

  const signedNames: string[] = ["date", "(request-target)", "host"];
  const signedLines: string[] = [
    `date: ${date}`,
    `(request-target): ${method.toLowerCase()} ${url.pathname}${url.search}`,
    `host: ${host}`,
  ];

  if (bodyStr !== undefined) {
    const sha = crypto.createHash("sha256").update(bodyStr, "utf8").digest("base64");
    const len = String(Buffer.byteLength(bodyStr, "utf8"));
    headers["content-type"] = "application/json";
    headers["content-length"] = len;
    headers["x-content-sha256"] = sha;
    signedNames.push("x-content-sha256", "content-type", "content-length");
    signedLines.push(`x-content-sha256: ${sha}`, `content-type: application/json`, `content-length: ${len}`);
  }

  let key: crypto.KeyObject;
  try {
    key = crypto.createPrivateKey(normalizePrivateKey(creds.privateKeyPem));
  } catch {
    const err = new Error(
      "The API private key could not be parsed. Paste the full PEM file including the BEGIN/END lines."
    ) as OciError;
    err.status = 0;
    throw err;
  }

  const signingString = signedLines.join("\n");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingString, "utf8"), key).toString("base64");
  const keyId = `${creds.tenancyOcid}/${creds.userOcid}/${creds.fingerprint}`;
  headers["authorization"] =
    `Signature version="1",keyId="${keyId}",algorithm="rsa-sha256",` +
    `headers="${signedNames.join(" ")}",signature="${signature}"`;

  const { status, headers: resHeaders, text } = await httpsJson(url, method, headers, bodyStr, opts.timeoutMs ?? 30_000);
  if (status >= 400) throw toOciError(status, resHeaders, text);
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/* ------------------------------------------------------------------ */
/* Typed wrappers over the endpoints the hunter needs                  */
/* ------------------------------------------------------------------ */

export interface AvailabilityDomain {
  name: string;
  id: string;
}

export interface OciImage {
  id: string;
  displayName: string;
  operatingSystem: string;
  operatingSystemVersion: string;
  timeCreated: string;
  sizeInMBs?: number;
}

export interface OciVcn {
  id: string;
  displayName: string;
  cidrBlocks: string[];
  lifecycleState: string;
}

export interface OciSubnet {
  id: string;
  displayName: string;
  cidrBlock: string;
  vcnId: string;
  lifecycleState: string;
}

export const oci = {
  listAvailabilityDomains(creds: OciCredentials, compartmentId: string) {
    return ociRequest<AvailabilityDomain[]>(creds, "GET", "identity", "/20160918/availabilityDomains", {
      query: { compartmentId },
    });
  },

  listImages(
    creds: OciCredentials,
    compartmentId: string,
    p: { operatingSystem: string; operatingSystemVersion: string; shape?: string; limit?: number }
  ) {
    return ociRequest<OciImage[]>(creds, "GET", "iaas", "/20160918/images", {
      query: {
        compartmentId,
        operatingSystem: p.operatingSystem,
        operatingSystemVersion: p.operatingSystemVersion,
        shape: p.shape ?? A1_SHAPE,
        sortBy: "TIMECREATED",
        sortOrder: "DESC",
        limit: p.limit ?? 5,
      },
    });
  },

  listVcns(creds: OciCredentials, compartmentId: string) {
    return ociRequest<OciVcn[]>(creds, "GET", "iaas", "/20160918/vcns", {
      query: { compartmentId, limit: 20 },
    });
  },

  listSubnets(creds: OciCredentials, compartmentId: string, vcnId: string) {
    return ociRequest<OciSubnet[]>(creds, "GET", "iaas", "/20160918/subnets", {
      query: { compartmentId, vcnId, limit: 20 },
    });
  },

  getSubnet(creds: OciCredentials, subnetId: string) {
    return ociRequest<OciSubnet>(creds, "GET", "iaas", `/20160918/subnets/${encodeURIComponent(subnetId)}`);
  },

  createVcn(creds: OciCredentials, p: { compartmentId: string; cidrBlocks: string[]; displayName: string }) {
    return ociRequest<any>(creds, "POST", "iaas", "/20160918/vcns", {
      body: { compartmentId: p.compartmentId, cidrBlocks: p.cidrBlocks, displayName: p.displayName },
    });
  },

  getVcn(creds: OciCredentials, vcnId: string) {
    return ociRequest<any>(creds, "GET", "iaas", `/20160918/vcns/${encodeURIComponent(vcnId)}`);
  },

  createInternetGateway(
    creds: OciCredentials,
    p: { compartmentId: string; vcnId: string; displayName: string; isEnabled: boolean }
  ) {
    return ociRequest<any>(creds, "POST", "iaas", "/20160918/internetGateways", {
      body: {
        compartmentId: p.compartmentId,
        vcnId: p.vcnId,
        displayName: p.displayName,
        isEnabled: p.isEnabled,
      },
    });
  },

  updateRouteTable(
    creds: OciCredentials,
    rtId: string,
    p: { displayName: string; routeRules: Array<{ destination: string; destinationType: string; networkEntityId: string }> }
  ) {
    return ociRequest<any>(creds, "PUT", "iaas", `/20160918/routeTables/${encodeURIComponent(rtId)}`, { body: p });
  },

  createSubnet(
    creds: OciCredentials,
    p: {
      compartmentId: string;
      vcnId: string;
      cidrBlock: string;
      displayName: string;
      routeTableId: string;
      securityListIds: string[];
    }
  ) {
    return ociRequest<OciSubnet>(creds, "POST", "iaas", "/20160918/subnets", { body: p });
  },

  launchInstance(creds: OciCredentials, payload: any) {
    return ociRequest<any>(creds, "POST", "iaas", "/20160918/instances/", { body: payload, timeoutMs: 45_000 });
  },

  getInstance(creds: OciCredentials, instanceId: string) {
    return ociRequest<any>(creds, "GET", "iaas", `/20160918/instances/${encodeURIComponent(instanceId)}`);
  },

  listVnicAttachments(creds: OciCredentials, p: { compartmentId: string; instanceId: string }) {
    return ociRequest<any[]>(creds, "GET", "iaas", "/20160918/vnicAttachments", {
      query: { compartmentId: p.compartmentId, instanceId: p.instanceId },
    });
  },

  getVnic(creds: OciCredentials, vnicId: string) {
    return ociRequest<any>(creds, "GET", "iaas", `/20160918/vnics/${encodeURIComponent(vnicId)}`);
  },
};
