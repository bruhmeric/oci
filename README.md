# OCI Free-Tier Hunter — Ampere A1 Capacity Sniper

A self-hosted web app that keeps calling Oracle Cloud's `LaunchInstance` API for
**VM.Standard.A1.Flex** (Ampere A1) until Oracle frees up capacity — the thing
free-tier users wait days or weeks for. It runs entirely **on the server**:
close your browser, log off, sleep — the hunt continues. It auto-resumes after
crashes and redeploys, pings you on Telegram when a server is secured, and
hands you the public IP + SSH command.

Built for the **Render free tier**: a built-in keep-alive ping stops Render
from spinning the instance down, and the hunt is (re)created from environment
variables on every boot, so an ephemeral disk can't kill it.

---

## How the "never stops" guarantee works

| Threat | Defence |
|---|---|
| You close the browser / log out | The hunt loop lives in the server process, not the page. Log back in and the same live console is there. |
| Render spins free instances down after 15 idle minutes | The server **pings its own public `/api/health` every ~10 minutes** (`KEEPALIVE_*` env vars). Inbound traffic = no spin-down. |
| Process crash / unhandled exception | Crash guards log and survive; hunt state is flushed every 60 s. |
| Render restarts the container (same deploy) | Hunt state on disk is restored at boot and the hunt **auto-resumes** with its attempt counters kept. |
| **Every deploy wipes the disk** (Render free tier has no persistent storage) | `HUNTER_AUTOSTART=true` rebuilds the hunt **from environment variables** at every boot. Counters reset, hunting continues. |
| OCI says "Out of host capacity" | Retried forever at your chosen interval — that's the whole point. |
| OCI says service limit exceeded (quota full) | The slot goes into a **30-minute cooldown and re-checks forever** instead of giving up. |
| Rate limits / 5xx / network blips | Automatic back-off and retry; first occurrence is reported to Telegram, totals ride the heartbeat. |

The only things that stop a hunt: **you** (Stop button, or `HUNTER_AUTOSTART=false`
+ redeploy) or a fatal misconfiguration (e.g. bad credentials).

---

## What you need

- An **Oracle Cloud** account (Always Free tier is fine)
- A **GitHub** account
- A **Render** account (free plan — 750 instance-hours/month, enough for 24/7)

## Step 1 — Create an OCI API signing key

1. Sign in to the OCI Console → click your **Profile** icon (top right) →
   **User Settings** → **API keys** → **Add API Key**.
2. Choose **Generate API Key Pair**, download the **private key**
   (`oci_api_key.pem`), then click **Add**.
3. The confirmation dialog shows a **Configuration File** preview — copy these
   four values from it:
   - `tenancy` → your `OCI_TENANCY_OCID`
   - `user` → your `OCI_USER_OCID`
   - `fingerprint` → your `OCI_FINGERPRINT`
   - `region` → your `OCI_REGION` (**must be your home region**, e.g.
     `ap-singapore-1` — check the region dropdown in the console top bar)
4. Encode the private key as one line (Render env vars are friendliest as a
   single line):

   ```bash
   # Linux
   base64 -w0 oci_api_key.pem
   # macOS
   base64 -i oci_api_key.pem
   # Windows (PowerShell) — then join the wrapped lines into one
   certutil -encode oci_api_key.pem encoded.txt
   ```

   Keep the output handy for `OCI_PRIVATE_KEY`. (A full PEM with newlines or
   literal `\n` also works — the app detects the format.)

> Your key only signs API calls from your Render service to OCI in your own
> tenancy. The dashboard is password-protected and the key is never sent to
> the browser.

## Step 2 — Push this project to GitHub

1. Unzip the project (if you received it as a zip).
2. Create a **new GitHub repository** (private is fine — Render reads private
   repos) — do **not** initialize it with a README.
3. Push:

   ```bash
   cd oci-a1-hunter
   git init
   git add .
   git commit -m "OCI A1 hunter — ready for Render"
   git branch -M main
   git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
   git push -u origin main
   ```

   `.gitignore` already excludes `.data/` (hunt state + stored keys), `.env`
   and everything else sensitive — check `git status` before committing if
   you're paranoid (you should be).

## Step 3 — Deploy on Render

### Option A — Manual (recommended the first time)

1. Render dashboard → **New +** → **Web Service** → connect your GitHub
   account and pick the repo.
2. Configure:
   - **Name**: anything (`oci-a1-hunter`)
   - **Region**: closest to your OCI home region (e.g. Singapore)
   - **Branch**: `main`
   - **Runtime**: leave **Node** (default)
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**
3. Add **Environment Variables** (button below):

   | Key | Value | Notes |
   |---|---|---|
   | `SITE_PASSWORD` | a strong password | dashboard login — **required**, the app is public |
   | `OCI_TENANCY_OCID` | `ocid1.tenancy.oc1...` | from Step 1 |
   | `OCI_USER_OCID` | `ocid1.user.oc1...` | from Step 1 |
   | `OCI_FINGERPRINT` | `aa:bb:...` | from Step 1 |
   | `OCI_REGION` | `ap-singapore-1` | **home region** |
   | `OCI_PRIVATE_KEY` | base64 blob from Step 1 | single line |
   | `HUNTER_AUTOSTART` | `true` | start/restore the hunt on every boot |
   | `HUNT_INSTANCE_COUNT` | `1` | optional, default 1 (max 2) |
   | `HUNT_OCPUS` | `4` | optional, default 4 |
   | `HUNT_MEMORY_GBS` | `24` | optional, default 24 |
   | `HUNT_BOOT_VOLUME_GB` | `50` | optional, default 50 (min 47) |
   | `HUNT_IMAGE_OS` | `ubuntu-24` | or `ubuntu-22`, `oracle-linux-9`, `oracle-linux-8` |
   | `HUNT_NAME_PREFIX` | `a1-hunter` | optional |
   | `HUNT_RETRY_INTERVAL_SEC` | `60` | optional, 20–600 |
   | `HUNT_SSH_PUBLIC_KEY` | `ssh-rsa AAAA...` | optional — your own SSH key (see below) |
   | `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | | optional — see Step 5 |

   All `HUNT_*` values are optional; defaults max out the Always Free
   allowance (1 × 4 OCPU / 24 GB / 50 GB Ubuntu 24.04).
4. Click **Create Web Service**. First build takes a few minutes.

### Option B — Blueprint (one-click from render.yaml)

This repo ships a `render.yaml` blueprint. Render → **New +** → **Blueprint** →
pick the repo → it creates the service and prompts for the secret values.
(`Deploy to Render` button: `https://render.com/deploy?repo=https://github.com/YOUR_NAME/YOUR_REPO`)

## Step 4 — Verify it's hunting

1. Open the service URL (`https://oci-a1-hunter-xxxx.onrender.com`).
2. Log in with `SITE_PASSWORD`.
3. You should land on the dashboard with a **live hunt** already running
   (started by `HUNTER_AUTOSTART` at boot). The console shows attempts like:
   `Attempt #12 — asking … for 4 OCPU / 24 GB` → `Out of host capacity · retry in 60s`.
4. Sanity checks:
   - `https://YOUR-APP.onrender.com/api/health` → JSON with `"ok": true` and
     the active hunt summary (public, but leaks nothing sensitive).
   - Render → **Logs**: look for
     `[env-boot] hunt #xxxxxxxx started from environment`,
     `[keepalive] self-ping armed → …` and `[hunter-store] restored …`.
5. Optional belt-and-braces: add an **UptimeRobot** (free) monitor for
   `/api/health` every 5 minutes. If the built-in self-ping ever hiccups,
   the external pinger keeps the instance awake. If the instance ever does
   spin down anyway, the first visitor wakes it in ~1 minute and the hunt
   auto-resumes — nothing is lost.

### SSH access to the created instance

- If you set `HUNT_SSH_PUBLIC_KEY`, SSH with that key:
  `ssh -i your-key user@PUBLIC_IP` (`ubuntu` for Ubuntu images, `opc` for
  Oracle Linux).
- If you didn't, the server **generates a fresh 4096-bit key** per deploy.
  Once a slot launches, download the private key from the dashboard
  (the amber **private key** button under the slot cards) — and note it is
  stored only on the (ephemeral) server disk, so download it promptly or set
  `HUNT_SSH_PUBLIC_KEY` for a permanent key.

## Step 5 — Telegram notifications (optional, recommended)

1. In Telegram, talk to **@BotFather** → `/newbot` → copy the **bot token**.
2. Send any message to your new bot (it can't message you first).
3. Get your chat id from **@userinfobot** (or paste the token into the app's
   Telegram card and press *detect*).
4. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in Render → Environment,
   then redeploy (or configure it live in the dashboard's Telegram card —
   env vars re-arm it after each deploy).

You'll get: hunt started/resumed, **INSTANCE LAUNCHED**, **SERVER READY**
(with IP + SSH command), first occurrence of throttles, periodic heartbeats.

## Controlling the hunt

| Action | How |
|---|---|
| Pause/stop now | **Stop hunt** button in the dashboard (finishes the current attempt, then halts). Survives restarts **within** the same deploy. |
| Resume | The form is pre-filled from the last hunt — press **Start hunting**. Or press **Resume** on an interrupted hunt. |
| Stop **permanently** (survives redeploys) | Render → Environment → set `HUNTER_AUTOSTART=false` (or delete the var) → **Manual Deploy**. Every future deploy stays idle until you start a hunt from the UI. |
| Change specs (OCPU/RAM/OS/region…) | Update the `HUNT_*` / `OCI_*` env vars → redeploy. A fresh hunt starts with the new config. |

## Free-tier facts worth knowing

- **750 instance-hours/month** on Render free — one service 24/7 uses ~720.
- **512 MB RAM / shared CPU** — plenty for this app (it's a timer + HTTPS calls).
- **Ephemeral disk**: everything written at runtime (hunt state, generated SSH
  key, Telegram settings) is wiped on each deploy. The env-var bootstrap makes
  that a non-issue for the hunt itself; attempt counters restart at 0.
- OCI Always Free A1 allowance: **4 OCPU + 24 GB RAM total** (e.g. one 4/24
  instance, two 2/12s, four 1/6s) + 200 GB block storage.

## Troubleshooting

| Symptom | Meaning / fix |
|---|---|
| Boot log: `HUNTER_AUTOSTART is on but incomplete credentials` | One of the `OCI_*` vars is missing/typo'd — Render → Environment. `OCI_REGION` must be your **home** region and match the key. |
| Hunt ends with *Authentication failed* | User OCID / tenancy / fingerprint / PEM don't belong to the same API key. Redo Step 1 carefully. |
| *Not authorized / Not found* on validate | Wrong region or compartment — use the home region; leave `OCI_COMPARTMENT_OCID` unset to use the root compartment. |
| Slot shows **Limit cooldown** | Your tenancy already uses its full A1 allowance (e.g. 4 OCPU). Terminate/free an A1 instance and the next re-check grabs the capacity — no action needed. |
| Instance launched but no public IP shown | It's on the VNIC — check the OCI console → instance → VNIC details. The app also keeps retrying the lookup. |
| Instance stuck TERMINATED/FAILED after launch | Usually boot-volume or capacity oddity — terminate it to free storage; the slot logs it. |
| The app feels asleep (slow first load) | The instance spun down (e.g. self-ping briefly failed). First request wakes it in ~1 min; the hunt auto-resumes. |
| Want to reset everything | Render → **Manual Deploy → Clear build cache & deploy**, or just delete the service. |

## Security notes

- The dashboard is password-gated (`SITE_PASSWORD`); every API route requires
  the session cookie except `/api/health` (which exposes only counters).
- Your OCI private key lives only in Render's env store + server memory/disk.
- Use a **strong, unique** password — the URL is public. For extra safety,
  front it with Cloudflare Access or keep the URL obscure.

## Local development

```bash
npm install
npm run dev      # http://localhost:3000 — configure everything from the UI
npm run build && npm start   # production check (standalone server)
```

State lives in `.data/` (git-ignored). On a laptop the hunt stops when the
laptop sleeps — that's what Render is for.
