/**
 * SSH keypair generation + OpenSSH public-key format conversion.
 *
 * Node's crypto exports RSA keys as PEM (SPKI/PKCS#8). OCI instance
 * metadata requires the OpenSSH "ssh-rsa AAAAB3..." authorized_keys
 * format, so we convert the SPKI JWK (e, n) into SSH wire format:
 *   string "ssh-rsa" | mpint e | mpint n   (each length-prefixed u32 BE)
 */
import crypto from "node:crypto";

export interface SshKeyPair {
  keyId: string;
  publicKey: string; // one line: ssh-rsa AAAA… comment
  privateKeyPem: string; // PKCS#8 PEM — accepted by modern OpenSSH (ssh -i)
  fingerprint: string; // SHA256 fingerprint of the public key
  comment: string;
  createdAt: string;
}

function sshString(b: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(b.length, 0);
  return Buffer.concat([len, b]);
}

function base64UrlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Convert an RSA public key in PEM (SPKI) to OpenSSH authorized_keys format. */
export function rsaPemToOpenSsh(pem: string, comment: string): string {
  const jwk = crypto.createPublicKey(pem).export({ format: "jwk" }) as { kty: string; e: string; n: string };
  if (jwk.kty !== "RSA") throw new Error("Not an RSA public key");
  const type = Buffer.from("ssh-rsa", "utf8");
  const e = base64UrlToBuffer(jwk.e);
  const n = base64UrlToBuffer(jwk.n);
  const blob = Buffer.concat([sshString(type), sshString(e), sshString(n)]);
  return `ssh-rsa ${blob.toString("base64")} ${comment}`;
}

export function generateSshKeyPair(comment = "oci-free-tier-hunter"): SshKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const sshPub = rsaPemToOpenSsh(publicKey, comment);
  const hash = crypto.createHash("sha256").update(Buffer.from(sshPub, "utf8")).digest("base64").replace(/=+$/, "");
  return {
    keyId: crypto.randomUUID(),
    publicKey: sshPub,
    privateKeyPem: privateKey,
    fingerprint: `SHA256:${hash}`,
    comment,
    createdAt: new Date().toISOString(),
  };
}
