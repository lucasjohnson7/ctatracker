# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A wall-mounted transit dashboard ("CTA Wall — Southport") showing CTA Brown Line arrivals, Red Line arrivals at Belmont (both directions), Metra UP-NW, a drive-vs-Metra commute card, Chicago sports scores, Sonos now-playing, weather, a photo slideshow, and pull-up/push-up counters. It runs across **two machines**:

- **Wall Pi** (`colinrecker@192.168.12.191`, Tailscale `100.126.101.86`, armv7l/Node 18): runs `server.js` via systemd (`ctatracker.service`, port 3000) and a Chromium kiosk pointed at `http://127.0.0.1:3000`. Repo checkout at `~/Projects/ctatracker`.
- **Home server** (`colinrecker@100.98.221.29`, x86_64): runs `poller.py` as a Docker container (`ctatracker-poller-1`, compose file in repo root, `Dockerfile.poller`) from `~/home-server/ctatracker`.

## Architecture / data flow

- **`poller.py`** (stdlib-only Python) polls CTA train/bus, Pace, Metra GTFS, ESPN scoreboards, Google Routes commute times, and fitness-logger's `/api/latest-activity`. Every output is written locally *and* POSTed to the Pi's token-authed **`POST /api/ingest/:name`** (`.json` = atomic replace, `.jsonl` = append). With `INGEST_TOKEN` unset the poller is standalone and only writes files — the old single-machine mode.
- The poller reads **layout back from the Pi** (`GET /api/layout`) to skip polling disabled tiles, and fetches Sonos through the Pi's `/api/sonos/now-playing` (the Pi holds the Sonos tokens). `PI_BASE_URL` points at the Pi; it must be the **Tailscale IP** — the Pi's firewall drops LAN traffic from the home server.
- **`server.js`** (Express, ESM) serves the static frontend (`index.html`, `control.html`, `analytics.html`) plus APIs. Older handlers in `api/` are Vercel-Edge-style modules run through a compat shim; newer ones (pullups, pushups, layout, analytics, ingest, health) are plain Express handlers. Counters live in SQLite (`data/pullups.db`, better-sqlite3 — native module, must be built on the Pi).
- **`control.html`** (phone) writes `data/layout.json` (tile toggles/theme); **`analytics.html`** charts the counters and the commute `.jsonl` logs.
- Presence (where the iPhone is) is **not** hosted on the Pi — `index.html` fetches `GET /api/presence` from the home server over Tailscale (`100.98.221.29`, same firewall constraint as `PI_BASE_URL` above). The receiver lives in `home-server-status/presence/`; iPhone geofence Shortcuts POST `{"location": "home"|"work"|"away"}` there. Responses still carry a derived `home` boolean, which is what `index.html` reads.
- **Metra delay notifications** — `check_metra_delays()` runs every `DELAY_INTERVAL` (5 min) from the poll loop, comparing the GTFS-realtime departure to the static schedule and publishing to ntfy when an upcoming UP-NW train is more than 5 min late or cancelled. Alerts are gated on presence so they match the direction about to be travelled: at `home` it watches outbound Irving Park departures (the real boarding station as of 2026-08-21), at `work` inbound Arlington Heights departures, and it stays silent while commuting or when presence is unknown rather than guessing. Only trains within the next 90 min count. Each train alerts once (state in `data/delay_alerts.json`, keyed by date so it self-cleans at midnight) and re-alerts only on a further 5 min slip. Needs `NTFY_URL`, `NTFY_TOPIC`, `NTFY_TOKEN` in `.env`; the token belongs to a `poller` ntfy user with **write-only** access to that one topic, not the admin user. `PRESENCE_URL` defaults to the home server and is normally left unset.
- **Metra UP-NW outbound**: `poller.py` tracks departures from both Clybourn and Irving Park (`fetch_metra_outbound(station)`, backed by a generalized GTFS static-schedule parse and the shared `_metra_realtime_deps()` real-time helper). Irving Park — the real boarding station — is always polled into `data/metra_irvingpk.json` and feeds both the drive-vs-Metra commute card and the delay alerts above. Clybourn is only polled into `data/metra_clybourn.json` when the dashboard's "Metra UP-NW Outbound" tile is set to show it. `control.html`'s "Outbound Station" selector (`metraStation` in `layout.json`) picks which file that display tile reads from, independent of the commute card/alerts.
- **`/api/health`** returns 503 when `data/train.json` is stale (>5 min) — the Glance status dashboard on the home server monitors it via the Tailscale IP.

## Deploying

```bash
scripts/deploy.sh
```

pushes `main` to GitHub **and** to the home server bare repo (`homeserver` remote — its post-receive hook checks out `~/home-server/ctatracker` and runs `docker compose up -d --build`), then fast-forwards the Pi's checkout and restarts `ctatracker.service`. Notes:

- `data/`, `.env`, `node_modules/`, `__pycache__/` are gitignored **runtime state** — deploys never touch them. Never commit them (node_modules once shipped a Mac binary to the Pi and crashed the server; the git history was rewritten 2026-07-19 to purge all of that, so old clones must `git fetch && git reset --hard origin/main`).
- If `package-lock.json` changes, run `npm ci` on the Pi (native better-sqlite3 build takes ~20 min on armv7).
- Docker env changes need `docker compose up -d --force-recreate` on the home server — `restart` does not re-read `.env`.
- The retired `ctatracker-poller.service`/`.timer` units were **deleted** from the Pi. Don't recreate them: the timer auto-restarted the service 1s after any stop, and a second poller double-bills the Google Routes API.

## Environment (.env, per machine)

- Pi: `CTA_TRAIN_KEY`, `CTA_BUS_KEY`, `SONOS_*`, `INGEST_TOKEN`.
- Home server (`~/home-server/ctatracker/.env`): the same keys plus `METRA_KEY`, `GOOGLE_API_KEY`, `FITNESS_URL`/`FITNESS_TOKEN` (fitness-logger's `HEALTH_EXPORT_TOKEN`), `PI_BASE_URL=http://100.126.101.86:3000`, `INGEST_TOKEN` (must match the Pi's).

## Backups & ops

- `scripts/backup-pi.sh` runs nightly from the Pi's crontab (3:10 AM): tars `data/` + `.env` to the home server `~/backups/ctatracker/`, 14-day retention.
- The Pi's crontab also reboots it nightly at 4:00 AM (`sudo /sbin/reboot`, logged to `~/reboot.log`). Added 2026-08-10: the Pi (a RAM-constrained Pi 2, 1GB) was hard-freezing every ~1-4 weeks and needing a manual power cycle — `last -x` showed unclean "crash" sessions and every boot did ext4 orphan-inode recovery, with the freeze interval shrinking over time. Chromium (the kiosk browser, autostarted via `~/.config/lxsession/LXDE-pi/autostart`, not systemd) was already at 522MB RSS after just 16h of uptime, consistent with a slow leak in the long-lived kiosk tab eventually forcing swap thrashing until the system wedges. The nightly reboot resets it before that can happen.
- Verify changes with `node --check server.js` and `python3 -m py_compile poller.py`; there are no tests.
- Poller logs: `docker logs ctatracker-poller-1` on the home server. Pi server logs: `journalctl -u ctatracker`.
