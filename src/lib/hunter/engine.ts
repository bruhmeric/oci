/**
 * The hunt engine — resolves prerequisites, boots the network,
 * then keeps calling LaunchInstance for every slot until OCI frees
 * up A1 capacity (or the user stops / a fatal error occurs).
 */
import { oci, A1_SHAPE } from "@/lib/oci/client";
import { classifyOciError, describeOciError, RETRYABLE_KINDS, isOciError } from "@/lib/oci/errors";
import { hunterStore } from "./store";
import {
  notifyHuntStarted,
  notifyHuntResumed,
  notifySlotLaunched,
  notifySlotRunning,
  notifyHuntFatal,
  notifyHuntFinished,
  notifyRetryIssue,
  notifySlotFatal,
  notifyPostLaunchFailure,
  startHeartbeat,
  stopHeartbeat,
} from "@/lib/notify/telegram";
import { IMAGE_OS_OPTIONS } from "./types";
import type { HuntJob, InstanceSlot } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sleep that a stop request can interrupt. Resolves true when interrupted. */
function interruptibleSleep(ms: number, job: HuntJob): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (job.stopRequested) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - start >= ms) {
        clearInterval(timer);
        resolve(false);
      }
    }, 500);
    if (typeof timer.unref === "function") timer.unref();
  });
}

/** Service-limit cooldown: when the tenancy A1 quota is full, re-check every 30 min
 *  instead of giving up — the user may free capacity (or the limit may be a
 *  transient report), and the hunt must keep running until the user stops it. */
const LIMIT_COOLDOWN_SEC = 1800;

export function startHunt(job: HuntJob): void {
  void runHunt(job).catch((e) => {
    job.status = "error";
    hunterStore.log(job.id, "error", `Hunt crashed: ${describeOciError(e)}`);
    notifyHuntFatal(job, `Hunt crashed: ${describeOciError(e)}`);
    hunterStore.markUpdated(job);
  });
}

/**
 * Resume every hunt that a server restart interrupted (and that nobody asked
 * to stop). Called from instrumentation.ts at boot and from the hunt list API
 * as a fallback. Idempotent — resumeHunt claims the job synchronously.
 */
export function resumeInterruptedHunts(): void {
  for (const job of hunterStore.listJobs()) {
    if (job.status !== "interrupted") continue;
    if (job.stopRequested) {
      job.status = "stopped";
      hunterStore.log(job.id, "info", "A stop was requested before the restart — this hunt stays stopped.");
      hunterStore.markUpdated(job);
      continue;
    }
    resumeHunt(job);
  }
}

/** Continue an interrupted hunt: keeps attempt counters, re-attaches launched slots. */
export function resumeHunt(job: HuntJob): void {
  if (job.status !== "interrupted") return; // synchronous claim → idempotent
  job.status = "starting";
  hunterStore.markUpdated(job);
  void runHunt(job, true).catch((e) => {
    job.status = "error";
    hunterStore.log(job.id, "error", `Hunt crashed: ${describeOciError(e)}`);
    notifyHuntFatal(job, `Hunt crashed: ${describeOciError(e)}`);
    hunterStore.markUpdated(job);
  });
}

async function runHunt(job: HuntJob, resumed = false) {
  const log = (level: Parameters<typeof hunterStore.log>[1], msg: string, slot?: number) =>
    hunterStore.log(job.id, level, msg, slot);
  const creds = job.config.credentials;
  const compartment = job.config.compartmentOcid || creds.tenancyOcid;

  try {
    job.status = "starting";
    hunterStore.markUpdated(job);

    /* ---------------- 1. availability domain (skip if already resolved) -- */
    if (!job.config.availabilityDomain) {
      const ads = await oci.listAvailabilityDomains(creds, compartment);
      const chosenAd = job.config.availabilityDomain && ads.some((a) => a.name === job.config.availabilityDomain)
        ? job.config.availabilityDomain
        : ads[0]?.name;
      if (!chosenAd) throw new Error("No availability domains visible in this compartment/region.");
      job.config.availabilityDomain = chosenAd;
      log("info", `Region ${creds.region} · ${ads.length} availability domain(s) → using ${chosenAd}`);
    } else if (resumed) {
      log("info", `Resuming in ${creds.region} · availability domain ${job.config.availabilityDomain} (already resolved).`);
    }

    /* ---------------- 2. image (skip if already resolved) ---------------- */
    const osOpt = IMAGE_OS_OPTIONS.find((o) => o.id === job.config.imageOsId) ?? IMAGE_OS_OPTIONS[0];
    if (!job.config.imageId) {
      const images = await oci.listImages(creds, compartment, {
        operatingSystem: osOpt.os,
        operatingSystemVersion: osOpt.version,
        shape: A1_SHAPE,
        limit: 5,
      });
      if (!images?.length) {
        throw new Error(`No ${osOpt.os} ${osOpt.version} image found for ${A1_SHAPE} in ${creds.region}.`);
      }
      const image = images[0];
      job.config.imageId = image.id;
      job.imageResolvedName = image.displayName;
      log("info", `Image locked → ${image.displayName} (aarch64)`);
    } else if (resumed) {
      log("info", `Image locked → ${job.imageResolvedName ?? job.config.imageId} (aarch64, already resolved).`);
    }

    /* ---------------- 3. network (skip if already built) ----------------- */
    if (!job.network) {
      await bootstrapNetwork(job, compartment);
    } else if (resumed) {
      log("info", `Reusing the network from before the restart — subnet ${job.network.subnetId}.`);
    }

    /* ---------------- 4. hunt! ------------------------------------------ */
    job.status = "running";
    hunterStore.markUpdated(job);
    if (resumed) {
      log(
        "success",
        `Hunt RESUMED after the restart — ${job.stats.totalAttempts} attempt(s) already made, counters kept. Back to holding the line…`
      );
      notifyHuntResumed(job);
    } else {
      log("success", `Hunt is LIVE — ${job.slots.length} slot(s), retry every ${job.config.retryIntervalSec}s. Waiting for Oracle to free capacity…`);
      notifyHuntStarted(job);
    }
    startHeartbeat(job);

    const tasks: Array<Promise<void>> = [];
    for (const slot of job.slots) {
      if (slot.status === "launched" && slot.instance) {
        // Instance exists but its final state / public IP was never confirmed.
        log("info", `${slot.displayName} was already launched — re-checking its state and public IP…`, slot.index);
        tasks.push(pollUntilRunning(job, slot, compartment, osOpt.sshUser));
      } else if (slot.status === "running" && slot.instance && !slot.instance.publicIp) {
        tasks.push(fetchPublicIp(job, slot, compartment, osOpt.sshUser));
      } else if (slot.status === "queued" || slot.status === "hunting" || slot.status === "launching" || slot.status === "limit") {
        // "limit" slots resume too — the service-limit cooldown survives restarts.
        tasks.push(runSlot(job, slot, compartment, osOpt.sshUser));
      }
      // running-with-IP / failed / stopped → nothing to do
    }
    if (tasks.length === 0) {
      finalize(job);
      return;
    }
    await Promise.all(tasks);

    finalize(job);
  } catch (e) {
    const kind = classifyOciError(e);
    job.status = "error";
    log("error", `Hunt aborted: ${describeOciError(e)}`);
    for (const s of job.slots) if (s.status === "queued" || s.status === "hunting" || s.status === "launching") s.status = "stopped";
    notifyHuntFatal(job, describeOciError(e));
    stopHeartbeat(job.id);
    if (kind === "auth" || kind === "not-found") {
      log("info", `Tip: ${hint(kind)}`);
    }
    hunterStore.markUpdated(job);
  }
}

function hint(kind: string): string {
  if (kind === "auth")
    return "Re-check the User OCID, Tenancy OCID, fingerprint and PEM key — they must all come from the same API signing key (OCI Console → Profile → User Settings → API keys).";
  if (kind === "not-found") return "Verify the compartment OCID exists and belongs to this tenancy, and that the region selected matches your home region.";
  if (kind === "limit-exceeded")
    return "The tenancy hit an A1 (Ampere) service limit — e.g. the 4 OCPU / 24 GB Always Free allowance is already used. Check OCI Console → Governance → Service limits, or terminate unused A1 instances.";
  if (kind === "bad-request")
    return "The launch request was rejected — common causes: boot volume below the image minimum, or a subnet outside the availability domain's region.";
  if (kind === "conflict") return "A resource with the same name/state already exists — check the OCI console for leftovers from a previous run.";
  return "";
}

function finalize(job: HuntJob) {
  const launched = job.slots.filter((s) => s.status === "launched" || s.status === "running").length;
  if (launched > 0) {
    job.status = "completed";
    hunterStore.log(job.id, "success", `Hunt finished — ${launched}/${job.slots.length} instance(s) secured.`);
  } else if (job.stopRequested) {
    job.status = "stopped";
    hunterStore.log(job.id, "info", "Hunt stopped by user.");
  } else {
    job.status = "error";
    hunterStore.log(job.id, "error", "Hunt ended without any instance launched.");
  }
  job.stats.finishedAt = new Date().toISOString();
  notifyHuntFinished(job);
  stopHeartbeat(job.id);
  hunterStore.markUpdated(job);
}

/* --------------------------------------------------------------------- */
/* Network bootstrap                                                      */
/* --------------------------------------------------------------------- */

async function bootstrapNetwork(job: HuntJob, compartment: string) {
  const log = (level: Parameters<typeof hunterStore.log>[1], msg: string) => hunterStore.log(job.id, level, msg);
  const creds = job.config.credentials;
  const prefix = job.config.namePrefix;

  if (job.config.networkMode === "existing" && job.config.existingSubnetId) {
    const subnet = await oci.getSubnet(creds, job.config.existingSubnetId);
    job.network = {
      vcnId: subnet.vcnId,
      subnetId: subnet.id,
      cidr: subnet.cidrBlock,
      created: false,
    };
    log("info", `Using existing subnet “${subnet.displayName}” (${subnet.cidrBlock}) — every instance still gets its own fresh VNIC with a public IP.`);
    return;
  }

  log("info", "Building a dedicated network: VCN → Internet Gateway → route → subnet (default security list already allows SSH port 22)…");

  for (let attempt = 0; attempt < 6; attempt++) {
    const octet = Math.floor(Math.random() * 200) + 10;
    const cidr = `10.${octet}.0.0/16`;
    try {
      const vcn = await oci.createVcn(creds, {
        compartmentId: compartment,
        cidrBlocks: [cidr],
        displayName: `${prefix}-vcn`,
      });

      // defaultRouteTableId / defaultSecurityListId can lag a moment
      let rtId: string | undefined = vcn.defaultRouteTableId;
      let slId: string | undefined = vcn.defaultSecurityListId;
      for (let i = 0; i < 10 && (!rtId || !slId); i++) {
        await sleep(1500);
        const v = await oci.getVcn(creds, vcn.id);
        rtId = v.defaultRouteTableId;
        slId = v.defaultSecurityListId;
      }
      if (!rtId || !slId) throw new Error("VCN default route table / security list never became ready.");

      const igw = await oci.createInternetGateway(creds, {
        compartmentId: compartment,
        vcnId: vcn.id,
        displayName: `${prefix}-igw`,
        isEnabled: true,
      });

      await oci.updateRouteTable(creds, rtId, {
        displayName: `${prefix}-rt`,
        routeRules: [{ destination: "0.0.0.0/0", destinationType: "CIDR_BLOCK", networkEntityId: igw.id }],
      });

      const subnet = await oci.createSubnet(creds, {
        compartmentId: compartment,
        vcnId: vcn.id,
        cidrBlock: `10.${octet}.1.0/24`,
        displayName: `${prefix}-subnet`,
        routeTableId: rtId,
        securityListIds: [slId],
      });

      for (let i = 0; i < 20; i++) {
        const s = await oci.getSubnet(creds, subnet.id);
        if (s.lifecycleState === "AVAILABLE") break;
        await sleep(1500);
      }

      job.network = { vcnId: vcn.id, subnetId: subnet.id, igwId: igw.id, cidr, created: true };
      log("success", `Network ready — VCN ${cidr} · subnet 10.${octet}.1.0/24 · internet gateway attached · SSH (22) open.`);
      return;
    } catch (e: any) {
      if (attempt < 5 && classifyOciError(e) === "bad-request" && /overlap|conflict/i.test(e?.message ?? "")) {
        log("warn", `CIDR ${cidr} overlaps an existing VCN — trying another range…`);
        continue;
      }
      throw e;
    }
  }
  throw new Error("Could not find a non-overlapping VCN CIDR after 6 attempts.");
}

/* --------------------------------------------------------------------- */
/* Per-slot retry loop                                                    */
/* --------------------------------------------------------------------- */

async function runSlot(job: HuntJob, slot: InstanceSlot, compartment: string, sshUser: string) {
  const log = (level: Parameters<typeof hunterStore.log>[1], msg: string) => hunterStore.log(job.id, level, msg, slot.index);
  const creds = job.config.credentials;
  const interval = job.config.retryIntervalSec;

  slot.status = "hunting";
  hunterStore.markUpdated(job);

  // Stagger multiple slots so we never fire two launches at the same instant.
  if (slot.index > 0) await interruptibleSleep(slot.index * 5000, job);

  while (!job.stopRequested) {
    slot.attempts += 1;
    job.stats.totalAttempts += 1;
    slot.lastAttemptAt = new Date().toISOString();
    slot.status = "launching";
    hunterStore.markUpdated(job);
    log("info", `Attempt #${slot.attempts} — asking ${job.config.availabilityDomain} for ${job.config.ocpus} OCPU / ${job.config.memoryInGBs} GB…`);

    try {
      const payload = buildLaunchPayload(job, slot, compartment, sshUser);
      const inst = await oci.launchInstance(creds, payload);
      slot.status = "launched";
      slot.nextAttemptAt = undefined;
      slot.lastError = undefined;
      slot.instance = {
        ocid: inst.id,
        lifecycleState: inst.lifecycleState ?? "PROVISIONING",
        timeCreated: inst.timeCreated,
        sshUser,
      };
      log("success", `INSTANCE LAUNCHED — ${inst.id}`);
      hunterStore.markUpdated(job);
      notifySlotLaunched(job, slot);
      void pollUntilRunning(job, slot, compartment, sshUser);
      return;
    } catch (e) {
      const kind = classifyOciError(e);
      slot.lastError = describeOciError(e);
      if (kind === "capacity") job.stats.capacityMisses += 1;
      else if (kind === "rate-limit") job.stats.rateLimits = (job.stats.rateLimits ?? 0) + 1;
      else if (kind === "server-error") job.stats.serverErrors = (job.stats.serverErrors ?? 0) + 1;
      else if (kind === "network") job.stats.networkErrors = (job.stats.networkErrors ?? 0) + 1;
      else if (kind === "limit-exceeded") job.stats.limitHits = (job.stats.limitHits ?? 0) + 1;

      if (kind === "auth") {
        slot.status = "failed";
        job.stopRequested = true;
        log("error", `Authentication failed — stopping the whole hunt. ${slot.lastError}`);
        notifySlotFatal(job, slot, "API block — authentication rejected", `${slot.lastError}\n${hint(kind)}`, true);
        hunterStore.markUpdated(job);
        return;
      }

      if (kind === "limit-exceeded") {
        // Service limit (A1 quota full) — DO NOT give up. Cool down, then
        // re-check: if the user frees capacity this slot grabs it, and the
        // hunt honours "run until I stop it".
        slot.status = "limit";
        slot.nextAttemptAt = new Date(Date.now() + LIMIT_COOLDOWN_SEC * 1000).toISOString();
        log(
          "warn",
          `Service limit reached — retrying in ${LIMIT_COOLDOWN_SEC / 60} min in case capacity frees up. ${slot.lastError}`
        );
        notifyRetryIssue(job, "limit", `${slot.lastError}\n${hint(kind)}`, LIMIT_COOLDOWN_SEC);
        hunterStore.markUpdated(job);

        const interrupted = await interruptibleSleep(LIMIT_COOLDOWN_SEC * 1000, job);
        if (interrupted) {
          slot.status = "stopped";
          log("info", "Slot stopped by user.");
          hunterStore.markUpdated(job);
          return;
        }
        continue; // back to the top — new launch attempt
      }

      if (!RETRYABLE_KINDS.has(kind)) {
        slot.status = "failed";
        log("error", `Fatal launch error — this slot gives up. ${slot.lastError}`);
        notifySlotFatal(job, slot, "Fatal launch error — slot gave up", `${slot.lastError}\n${hint(kind)}`, false);
        hunterStore.markUpdated(job);
        return;
      }

      const waitSec =
        kind === "rate-limit"
          ? Math.min(interval * 2, 300)
          : Math.max(15, interval + (job.config.jitter ? Math.round((Math.random() - 0.5) * interval * 0.2) : 0));
      if (kind === "rate-limit" || kind === "server-error" || kind === "network") {
        notifyRetryIssue(job, kind, slot.lastError ?? "unknown error", waitSec);
      }
      slot.status = "hunting";
      slot.nextAttemptAt = new Date(Date.now() + waitSec * 1000).toISOString();
      const tag = kind === "capacity" ? "Out of host capacity" : kind === "rate-limit" ? "Rate limited" : kind === "network" ? "Network hiccup" : "Transient server error";
      log("retry", `${tag} · attempt #${slot.attempts} failed → next try in ${waitSec}s. ${kind === "capacity" ? "Holding the line…" : ""}`);
      hunterStore.markUpdated(job);

      const interrupted = await interruptibleSleep(waitSec * 1000, job);
      if (interrupted) {
        slot.status = "stopped";
        log("info", "Slot stopped by user.");
        hunterStore.markUpdated(job);
        return;
      }
    }
  }

  slot.status = "stopped";
  log("info", "Slot stopped by user.");
  hunterStore.markUpdated(job);
}

function buildLaunchPayload(job: HuntJob, slot: InstanceSlot, compartment: string, sshUser: string) {
  const c = job.config;
  return {
    availabilityDomain: c.availabilityDomain,
    compartmentId: compartment,
    displayName: slot.displayName,
    shape: A1_SHAPE,
    shapeConfig: { ocpus: c.ocpus, memoryInGBs: c.memoryInGBs },
    sourceDetails: {
      sourceType: "image",
      imageId: c.imageId,
      bootVolumeSizeInGBs: c.bootVolumeSizeInGBs,
    },
    createVnicDetails: {
      subnetId: job.network?.subnetId,
      assignPublicIp: true,
      displayName: `${slot.displayName}-vnic`,
      hostnameLabel: slot.displayName.replace(/[^a-z0-9-]/gi, "").replace(/-+/g, "-").replace(/^-|-$/g, ""),
    },
    metadata: {
      ssh_authorized_keys: c.sshPublicKey,
    },
    agentConfig: { isMonitoringDisabled: false, isManagementDisabled: false },
    freeformTags: { app: "oci-free-tier-hunter", ssh_user: sshUser },
  };
}

/* --------------------------------------------------------------------- */
/* Post-launch polling                                                    */
/* --------------------------------------------------------------------- */

async function pollUntilRunning(job: HuntJob, slot: InstanceSlot, compartment: string, sshUser: string) {
  const log = (level: Parameters<typeof hunterStore.log>[1], msg: string) => hunterStore.log(job.id, level, msg, slot.index);
  const creds = job.config.credentials;
  const deadline = Date.now() + 10 * 60 * 1000;

  while (Date.now() < deadline) {
    try {
      const inst = await oci.getInstance(creds, slot.instance!.ocid);
      slot.instance!.lifecycleState = inst.lifecycleState;
      hunterStore.markUpdated(job);

      if (inst.lifecycleState === "TERMINATED" || inst.lifecycleState === "FAILED") {
        slot.status = "failed";
        log("error", `Instance ended up in state ${inst.lifecycleState} — check the OCI console.`);
        notifyPostLaunchFailure(
          job,
          slot,
          `Instance reached state ${inst.lifecycleState} — it will not come up. Check the OCI console; consider terminating it to free the boot-volume storage.`
        );
        return;
      }
      if (inst.lifecycleState === "RUNNING") {
        slot.status = "running";
        log("success", `${slot.displayName} is RUNNING — fetching its public IP…`);
        await fetchPublicIp(job, slot, compartment, sshUser);
        return;
      }
    } catch (e) {
      if (!isOciError(e) || e.status !== 404) {
        log("warn", `State poll failed (${describeOciError(e)}) — retrying…`);
      }
    }
    await sleep(5000);
  }
  log("warn", "Timed out waiting for RUNNING state — the instance may still come up; check the OCI console.");
  notifyPostLaunchFailure(job, slot, "10 minutes without reaching RUNNING — it may still come up; check the OCI console.");
}

async function fetchPublicIp(job: HuntJob, slot: InstanceSlot, compartment: string, sshUser: string) {
  const log = (level: Parameters<typeof hunterStore.log>[1], msg: string) => hunterStore.log(job.id, level, msg, slot.index);
  const creds = job.config.credentials;

  for (let i = 0; i < 25; i++) {
    try {
      const atts = await oci.listVnicAttachments(creds, { compartmentId: compartment, instanceId: slot.instance!.ocid });
      const vnicId = atts?.[0]?.vnicId;
      if (vnicId) {
        const vnic = await oci.getVnic(creds, vnicId);
        if (vnic.publicIp) {
          slot.instance!.publicIp = vnic.publicIp;
          slot.instance!.privateIp = vnic.privateIp;
          hunterStore.markUpdated(job);
          log("success", `PUBLIC IP ${vnic.publicIp} · connect with → ssh -i <your-key>.pem ${sshUser}@${vnic.publicIp}`);
          notifySlotRunning(job, slot);
          hunterStore.persist();
          return;
        }
      }
    } catch (e) {
      log("debug", `VNIC lookup pending (${describeOciError(e)})…`);
    }
    await sleep(4000);
  }
  log("warn", "Public IP not visible yet — find it in the OCI console under the instance's VNIC details.");
  notifyPostLaunchFailure(
    job,
    slot,
    "Public IP not visible yet — find it in the OCI console under the instance's VNIC details. Everything else is fine."
  );
}
