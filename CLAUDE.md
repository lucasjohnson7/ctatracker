# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A wall-mounted transit dashboard ("CTA Wall — Southport") showing CTA Brown Line arrivals, Metra UP-NW, the #77 bus, a drive-vs-Metra commute card, Chicago sports scores, Sonos now-playing, weather, a photo slideshow, and pull-up/push-up counters. It runs across **two machines**:

- **Wall Pi** (`colinrecker@192.168.12.191`, Tailscale `100.126.101.86`, armv7l/Node 18): runs `server.js` via systemd (`ctatracker.service`, port 3000) and a Chromium kiosk pointed at `http://127.0.0.1:3000`. Repo checkout at `~/Projects/ctatracker`.
- **Home server** (`colinrecker@100.98.221.29`, x86_64): runs `poller.py` as a Docker container (`ctatracker-poller-1`, compose file in repo root, `Dockerfile.poller`) from `~/home-server/ctatracker`.

## Architecture / data flow

- **`poller.py`** (stdlib-only Python) polls CTA train/bus, Pace, Metra GTFS, ESPN scoreboards, Google Routes commute times, and fitness-logger's `/api/latest-activity`. Every output is written locally *and* POSTed to the Pi's token-authed **`POST /api/ingest/:name`** (`.json` = atomic replace, `.jsonl` = append). With `INGEST_TOKEN` unset the poller is standalone and only writes files — the old single-machine mode.
- The poller reads **layout back from the Pi** (`GET /api/layout`) to skip polling disabled tiles, and fetches Sonos through the Pi's `/api/sonos/now-playing` (the Pi holds the Sonos tokens). `PI_BASE_URL` points at the Pi; it must be the **Tailscale IP** — the Pi's firewall drops LAN traffic from the home server.
- **`server.js`** (Express, ESM) serves the static frontend (`index.html`, `control.html`, `analytics.html`) plus APIs. Older handlers in `api/` are Vercel-Edge-style modules run through a compat shim; newer ones (pullups, pushups, layout, presence, analytics, ingest, health) are plain Express handlers. Counters live in SQLite (`data/pullups.db`, better-sqlite3 — native module, must be built on the Pi).
- **`control.html`** (phone) writes `data/layout.json` (tile toggles/theme) and presence; **`analytics.html`** charts the counters and the commute `.jsonl` logs.
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
- Verify changes with `node --check server.js` and `python3 -m py_compile poller.py`; there are no tests.
- Poller logs: `docker logs ctatracker-poller-1` on the home server. Pi server logs: `journalctl -u ctatracker`.
