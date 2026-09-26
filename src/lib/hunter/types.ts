/**
 * Shared hunter types — imported by both the server engine and the client UI.
 * Must stay free of any node-only imports so it can be bundled safely.
 */
import type { OciCredentials } from "@/lib/oci/client";

export const A1_FREE_ALLOWANCE = { ocpus: 4, memoryInGBs: 24, bootVolumeGBs: 200 };

export interface ImageOsOption {
  id: string;
  label: string;
  os: string;
  version: string;
  sshUser: string;
}

export const IMAGE_OS_OPTIONS: ImageOsOption[] = [
  { id: "ubuntu-24", label: "Ubuntu 24.04 LTS · aarch64", os: "Canonical Ubuntu", version: "24.04", sshUser: "ubuntu" },
  { id: "ubuntu-22", label: "Ubuntu 22.04 LTS · aarch64", os: "Canonical Ubuntu", version: "22.04", sshUser: "ubuntu" },
  { id: "oracle-linux-9", label: "Oracle Linux 9 · aarch64", os: "Oracle Linux", version: "9", sshUser: "opc" },
  { id: "oracle-linux-8", label: "Oracle Linux 8 · aarch64", os: "Oracle Linux", version: "8", sshUser: "opc" },
];

/**
 * Region list per https://docs.oracle.com/en-us/iaas/Content/General/Concepts/regions.htm
 * Singapore tenancies may be homed in ap-singapore-1 OR ap-singapore-2 (Singapore West) —
 * the home region is what must be used for API signing validation.
 */
export const OCI_REGIONS: Array<{ id: string; label: string }> = [
  { id: "ap-singapore-2", label: "Singapore West (ap-singapore-2)" },
  { id: "ap-singapore-1", label: "Singapore (ap-singapore-1)" },
  { id: "ap-mumbai-1", label: "Mumbai (ap-mumbai-1)" },
  { id: "ap-hyderabad-1", label: "Hyderabad (ap-hyderabad-1)" },
  { id: "ap-tokyo-1", label: "Tokyo (ap-tokyo-1)" },
  { id: "ap-osaka-1", label: "Osaka (ap-osaka-1)" },
  { id: "ap-seoul-1", label: "Seoul (ap-seoul-1)" },
  { id: "ap-chuncheon-1", label: "Chuncheon (ap-chuncheon-1)" },
  { id: "ap-sydney-1", label: "Sydney (ap-sydney-1)" },
  { id: "ap-melbourne-1", label: "Melbourne (ap-melbourne-1)" },
  { id: "ap-jakarta-1", label: "Jakarta (ap-jakarta-1)" },
  { id: "ap-batam-1", label: "Batam (ap-batam-1)" },
  { id: "ap-kulai-2", label: "Kulai (ap-kulai-2)" },
  { id: "me-dubai-1", label: "Dubai (me-dubai-1)" },
  { id: "me-jeddah-1", label: "Jeddah (me-jeddah-1)" },
  { id: "me-abudhabi-1", label: "Abu Dhabi (me-abudhabi-1)" },
  { id: "me-riyadh-1", label: "Riyadh (me-riyadh-1)" },
  { id: "il-jerusalem-1", label: "Jerusalem (il-jerusalem-1)" },
  { id: "eu-frankfurt-1", label: "Frankfurt (eu-frankfurt-1)" },
  { id: "eu-amsterdam-1", label: "Amsterdam (eu-amsterdam-1)" },
  { id: "eu-milan-1", label: "Milan (eu-milan-1)" },
  { id: "eu-turin-1", label: "Turin (eu-turin-1)" },
  { id: "eu-marseille-1", label: "Marseille (eu-marseille-1)" },
  { id: "eu-madrid-1", label: "Madrid (eu-madrid-1)" },
  { id: "eu-madrid-3", label: "Madrid West (eu-madrid-3)" },
  { id: "eu-paris-1", label: "Paris (eu-paris-1)" },
  { id: "eu-stockholm-1", label: "Stockholm (eu-stockholm-1)" },
  { id: "eu-zurich-1", label: "Zurich (eu-zurich-1)" },
  { id: "eu-jovanovac-1", label: "Jovanovac (eu-jovanovac-1)" },
  { id: "uk-london-1", label: "London (uk-london-1)" },
  { id: "uk-cardiff-1", label: "Cardiff (uk-cardiff-1)" },
  { id: "af-johannesburg-1", label: "Johannesburg (af-johannesburg-1)" },
  { id: "af-casablanca-1", label: "Casablanca (af-casablanca-1)" },
  { id: "us-ashburn-1", label: "Ashburn (us-ashburn-1)" },
  { id: "us-phoenix-1", label: "Phoenix (us-phoenix-1)" },
  { id: "us-sanjose-1", label: "San Jose (us-sanjose-1)" },
  { id: "us-chicago-1", label: "Chicago (us-chicago-1)" },
  { id: "ca-toronto-1", label: "Toronto (ca-toronto-1)" },
  { id: "ca-montreal-1", label: "Montreal (ca-montreal-1)" },
  { id: "sa-saopaulo-1", label: "São Paulo (sa-saopaulo-1)" },
  { id: "sa-vinhedo-1", label: "Vinhedo (sa-vinhedo-1)" },
  { id: "sa-valparaiso-1", label: "Valparaíso (sa-valparaiso-1)" },
  { id: "sa-santiago-1", label: "Santiago (sa-santiago-1)" },
  { id: "sa-bogota-1", label: "Bogotá (sa-bogota-1)" },
  { id: "mx-queretaro-1", label: "Querétaro (mx-queretaro-1)" },
  { id: "mx-monterrey-1", label: "Monterrey (mx-monterrey-1)" },
];

/* ------------------------- hunt configuration ------------------------- */

export interface HuntConfig {
  credentials: OciCredentials;
  compartmentOcid: string;
  ocpus: number;
  memoryInGBs: number;
  bootVolumeSizeInGBs: number;
  imageOsId: string;
  imageId?: string;
  instanceCount: number;
  namePrefix: string;
  networkMode: "auto" | "existing";
  existingSubnetId?: string;
  retryIntervalSec: number;
  jitter: boolean;
  sshPublicKey: string;
  sshKeyId?: string;
  availabilityDomain?: string;
}

export type SlotStatus =
  | "queued"
  | "hunting"
  | "launching"
  | "launched"
  | "running"
  | "limit"
  | "failed"
  | "stopped";

export type JobStatus = "starting" | "running" | "completed" | "stopped" | "error" | "interrupted";

export interface SlotInstanceInfo {
  ocid: string;
  lifecycleState: string;
  publicIp?: string;
  privateIp?: string;
  timeCreated?: string;
  sshUser?: string;
}

export interface InstanceSlot {
  index: number;
  displayName: string;
  status: SlotStatus;
  attempts: number;
  lastError?: string;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  instance?: SlotInstanceInfo;
}

export type LogLevel = "info" | "success" | "warn" | "error" | "retry" | "debug";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  slot?: number;
  message: string;
}

export interface HuntNetwork {
  vcnId: string;
  subnetId: string;
  igwId?: string;
  cidr: string;
  created: boolean;
}

export interface HuntJobStats {
  totalAttempts: number;
  capacityMisses: number;
  /** Retryable failures absorbed automatically (optional — older saved hunts lack these). */
  rateLimits?: number;
  serverErrors?: number;
  networkErrors?: number;
  /** Service-limit cooldowns entered (quota full → 30-min re-checks, never gives up). */
  limitHits?: number;
  startedAt: string;
  finishedAt?: string;
}

export interface HuntJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  config: HuntConfig;
  slots: InstanceSlot[];
  logs: LogEntry[];
  network?: HuntNetwork;
  stats: HuntJobStats;
  imageResolvedName?: string;
  stopRequested: boolean;
}

/** What the API returns — credentials stripped of the private key. */
export interface HuntJobSnapshot extends Omit<HuntJob, "config" | "logs"> {
  config: Omit<HuntConfig, "credentials"> & { credentials: Omit<OciCredentials, "privateKeyPem"> };
  logs: LogEntry[];
}

export const TERMINAL_SLOT_STATUSES: SlotStatus[] = [
  "running",
  "launched",
  "limit",
  "failed",
  "stopped",
];

export function jobToSnapshot(job: HuntJob, maxLogs = 500): HuntJobSnapshot {
  const { credentials, ...restConfig } = job.config;
  const { privateKeyPem: _omit, ...safeCreds } = credentials;
  return {
    ...job,
    config: { ...restConfig, credentials: safeCreds } as HuntJobSnapshot["config"],
    logs: job.logs.slice(-maxLogs),
  };
}

export function slotLaunched(s: InstanceSlot): boolean {
  return s.status === "launched" || s.status === "running";
}
