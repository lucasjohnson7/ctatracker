#!/usr/bin/env python3

import os
import json
import csv
import io
import zipfile
import datetime
import ssl
import time
from urllib.request import urlopen, Request

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")

def load_dotenv(path=".env"):
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
    except FileNotFoundError:
        pass

load_dotenv(os.path.join(ROOT, ".env"))

CTA_TRAIN_KEY   = os.environ.get("CTA_TRAIN_KEY", "")
CTA_BUS_KEY     = os.environ.get("CTA_BUS_KEY", "")
METRA_KEY       = os.environ.get("METRA_KEY", "")
GOOGLE_API_KEY  = os.environ.get("GOOGLE_API_KEY", "")
FITNESS_URL   = os.environ.get("FITNESS_URL", "http://100.98.221.29:3002")
FITNESS_TOKEN = os.environ.get("FITNESS_TOKEN", "")

# The poller runs on the home server; the wall Pi's express serves data/ as
# static files, reads layout.json, and proxies Sonos. PI_BASE_URL points at it.
# With INGEST_TOKEN unset the poller is standalone (writes local files only),
# which is exactly the old behavior when running on the Pi itself.
PI_BASE_URL  = os.environ.get("PI_BASE_URL", "http://localhost:3000")
INGEST_TOKEN = os.environ.get("INGEST_TOKEN", "")

# Push notifications for Metra delays. NTFY_* come from the home server's
# ntfy container; the token belongs to a `poller` user with write-only access
# to this one topic, not to the admin user. PRESENCE_URL is the home server's
# presence receiver — delays are only worth pushing for the direction being
# travelled next, so alerts are gated on where the phone says it is.
NTFY_URL     = os.environ.get("NTFY_URL", "")
NTFY_TOPIC   = os.environ.get("NTFY_TOPIC", "")
NTFY_TOKEN   = os.environ.get("NTFY_TOKEN", "")
PRESENCE_URL = os.environ.get("PRESENCE_URL", "http://100.98.221.29/api/presence")

DELAY_THRESHOLD_MIN = 5   # "late" starts here
DELAY_LOOKAHEAD_MIN = 90  # ignore trains further out than this
DELAY_REALERT_MIN   = 5   # re-alert a train only if it slips this much further
DELAY_STATE_FILE    = os.path.join(DATA_DIR, "delay_alerts.json")

COMMUTE_ORIGIN      = "1454 W School St, Chicago IL 60657"
COMMUTE_DESTINATION = "2000 Progress Pkwy, Schaumburg IL"
COMMUTE_RETURN_ORIGIN      = "2000 Progress Pkwy, Schaumburg IL"
COMMUTE_RETURN_DESTINATION = "1454 W School St, Chicago IL 60657"

# Set VERIFY_SSL=0 in env if certs ever break
VERIFY_SSL = os.environ.get("VERIFY_SSL", "1") != "0"

# ESPN endpoints
ESPN_NBA_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
ESPN_NFL_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
ESPN_NCAAM_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard"

ESPN_BULLS_TEAM = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/chi"
ESPN_BEARS_TEAM = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/chi"
ESPN_CREIGHTON_TEAM = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/156"

# Polling cadences
TRANSIT_INTERVAL  = 20   # seconds
SPORTS_INTERVAL   = 120  # seconds
COMMUTE_INTERVAL  = 300  # seconds (5 min — ~1,050 Routes API calls/month at 5-9 AM weekdays.
                          # TRAFFIC_AWARE routingPreference puts these in Google's Pro SKU
                          # tier, whose free monthly allowance is ~5,000 calls, not the
                          # Essentials tier's ~10,000 — keep well under that with margin.)
ACTIVITY_INTERVAL = 300  # seconds (5 min — Supabase latest activity)
DELAY_INTERVAL    = 300  # seconds (5 min — Metra delay push notifications)


def now_iso():
    return datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def ensure_dir(path):
    os.makedirs(path, exist_ok=True)


def push_to_pi(name, obj):
    """Mirror a data file (or one .jsonl line) to the Pi's ingest endpoint.

    No-op unless INGEST_TOKEN is set. Failures just log — every output is
    re-pushed on its next poll cycle, and jsonl lines also persist locally."""
    if not INGEST_TOKEN:
        return
    try:
        http_post_json(
            f"{PI_BASE_URL}/api/ingest/{name}",
            obj,
            headers={
                "Authorization": f"Bearer {INGEST_TOKEN}",
                "Content-Type": "application/json",
            },
        )
    except Exception as e:
        print(f"Ingest push error ({name}): {e}")


def write_json_atomic(filepath, obj):
    tmp = filepath + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f)
    os.replace(tmp, filepath)
    push_to_pi(os.path.basename(filepath), obj)


def append_jsonl(filepath, entry):
    with open(filepath, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    push_to_pi(os.path.basename(filepath), entry)


def http_post_json(url, body, headers=None, timeout=12):
    data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers=headers or {}, method="POST")
    ctx = ssl.create_default_context() if VERIFY_SSL else ssl._create_unverified_context()
    with urlopen(req, timeout=timeout, context=ctx) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def http_get_json(url, headers=None, timeout=12):
    req = Request(url, headers=headers or {})

    ctx = ssl.create_default_context() if VERIFY_SSL else ssl._create_unverified_context()

    with urlopen(req, timeout=timeout, context=ctx) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


# ===== Helpers =====

def is_weekday_morning():
    """True if it's currently Monday–Friday, 5:00–9:59 AM local time."""
    now = datetime.datetime.now()
    return now.weekday() < 5 and 5 <= now.hour < 9


# ===== CTA Transit =====

def fetch_cta_trains(mapid):
    if not CTA_TRAIN_KEY:
        return {"rows": [], "error": "Missing CTA_TRAIN_KEY", "updatedAt": now_iso()}

    url = (
        "https://lapi.transitchicago.com/api/1.0/ttarrivals.aspx"
        f"?key={CTA_TRAIN_KEY}&mapid={mapid}&outputType=JSON"
    )

    try:
        j = http_get_json(url)
        rows = (j.get("ctatt") or {}).get("eta") or []

        cleaned = [{
            "rn": x.get("rn"),
            "destNm": x.get("destNm"),
            "stpDe": x.get("stpDe"),
            "arrT": x.get("arrT"),
        } for x in rows]

        return {"rows": cleaned, "error": None, "updatedAt": now_iso()}

    except Exception as e:
        return {"rows": [], "error": str(e), "updatedAt": now_iso()}


def fetch_cta_bus_predictions(stpid, rt="77", top="6"):
    if not CTA_BUS_KEY:
        return {"rows": [], "error": "Missing CTA_BUS_KEY", "updatedAt": now_iso()}

    url = (
        "https://www.ctabustracker.com/bustime/api/v3/getpredictions"
        f"?format=json&key={CTA_BUS_KEY}&rt={rt}&stpid={stpid}&top={top}"
    )

    try:
        j = http_get_json(url, headers={"User-Agent": "ctatracker-local/1.0"})
        root = j.get("bustime-response") or j.get("bustime_response") or {}

        api_err = None
        if root.get("error"):
            api_err = (root["error"][0] or {}).get("msg", "CTA bus error")

        return {
            "rows": root.get("prd") or [],
            "error": api_err,
            "updatedAt": now_iso(),
        }

    except Exception as e:
        return {"rows": [], "error": str(e), "updatedAt": now_iso()}


# ===== Metra =====

METRA_STOP_NAMES = {
    "OTC":        "Ogilvie",
    "CLYBOURN":   "Clybourn",
    "IRVINGPK":   "Irving Park",
    "JEFFERSONP":  "Jefferson Park",
    "GLADSTNE":   "Gladstone Park",
    "NORWOODP":   "Norwood Park",
    "EDISONPK":   "Edison Park",
    "PARKRIDGE":  "Park Ridge",
    "DEEROAD":    "Dee Road",
    "DESPLAINES": "Des Plaines",
    "CUMBERLAND": "Cumberland",
    "GOLF":       "Golf",
    "MTPROSPECT": "Mt Prospect",
    "ARLINGTNHT": "Arlington Heights",
    "ARLINGTNPK": "Arlington Park",
    "PALATINE":   "Palatine",
    "BARRINGTON": "Barrington",
    "FOXRG":      "Fox River Grove",
    "CARY":       "Cary",
    "PINGREE":    "Pingree Road",
    "CRYSTAL":    "Crystal Lake",
    "WOODSTOCK":  "Woodstock",
    "HARVARD":    "Harvard",
    "MCHENRY":    "McHenry",
}

METRA_SCHEDULE_URL   = "https://schedules.metrarail.com/gtfs/schedule.zip"
METRA_SCHEDULE_CACHE = os.path.join(DATA_DIR, "metra_schedule_cache.json")
METRA_SCHEDULE_TTL   = 24 * 3600  # refresh once a day

_metra_schedule = None
_metra_schedule_loaded_at = 0


def _parse_dep_secs(t_str):
    """Parse HH:MM:SS (possibly > 24h) to seconds since midnight."""
    parts = t_str.strip().split(":")
    if len(parts) != 3:
        return None
    try:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except ValueError:
        return None


def load_metra_static_schedule(force=False):
    """Download GTFS zip and cache Clybourn outbound UP-NW departures."""
    global _metra_schedule, _metra_schedule_loaded_at

    # Use in-memory cache if fresh
    if not force and _metra_schedule and (time.time() - _metra_schedule_loaded_at < METRA_SCHEDULE_TTL):
        return _metra_schedule

    # Try disk cache first
    if not force:
        try:
            with open(METRA_SCHEDULE_CACHE) as f:
                cached = json.load(f)
            age = time.time() - datetime.datetime.fromisoformat(cached.get("updatedAt","2000-01-01")).timestamp()
            if age < METRA_SCHEDULE_TTL:
                _metra_schedule = cached
                _metra_schedule_loaded_at = time.time()
                return cached
        except Exception:
            pass

    print("Downloading Metra GTFS static schedule...")
    try:
        req = Request(METRA_SCHEDULE_URL, headers={"User-Agent": "ctatracker-local/1.0"})
        ctx = ssl.create_default_context() if VERIFY_SSL else ssl._create_unverified_context()
        with urlopen(req, timeout=60, context=ctx) as resp:
            zip_data = resp.read()

        zf = zipfile.ZipFile(io.BytesIO(zip_data))

        def gtfs_reader(zf, filename):
            """DictReader with space-stripped field names and values."""
            f = io.TextIOWrapper(zf.open(filename), encoding="utf-8-sig")
            reader = csv.DictReader(f, skipinitialspace=True)
            for row in reader:
                yield {k.strip(): v.strip() for k, v in row.items()}

        # 1. UP-NW trips: trip_id -> service_id
        upnw_trips = {}
        for row in gtfs_reader(zf, "trips.txt"):
            if row.get("route_id") == "UP-NW":
                upnw_trips[row["trip_id"]] = row["service_id"]

        # 2. Build stop sequences for UP-NW trips
        trip_stops = {}
        for row in gtfs_reader(zf, "stop_times.txt"):
            tid = row["trip_id"]
            if tid not in upnw_trips:
                continue
            t_str = row.get("departure_time") or row.get("arrival_time", "")
            secs = _parse_dep_secs(t_str)
            if secs is None:
                continue
            if tid not in trip_stops:
                trip_stops[tid] = []
            trip_stops[tid].append((int(row.get("stop_sequence", 0)), row["stop_id"], secs))

        # 3. Filter to outbound trips that stop at Clybourn
        clybourn_deps = {}
        for tid, stops in trip_stops.items():
            stops.sort()
            stop_ids = [s[1] for s in stops]
            if "CLYBOURN" not in stop_ids:
                continue
            idx = stop_ids.index("CLYBOURN")
            if "OTC" in stop_ids[idx + 1:]:
                continue  # inbound
            dep_secs = stops[idx][2]
            terminal = METRA_STOP_NAMES.get(stop_ids[-1], stop_ids[-1])
            # Arlington Heights arrival time (if this train stops there)
            arlington_secs = None
            if "ARLINGTNHT" in stop_ids:
                aidx = stop_ids.index("ARLINGTNHT")
                arlington_secs = stops[aidx][2]
            clybourn_deps[tid] = {
                "service_id": upnw_trips[tid],
                "dep_secs": dep_secs,
                "terminal": terminal,
                "arlington_secs": arlington_secs,
            }

        # 3b. Inbound trips departing Arlington Heights toward OTC
        arlington_deps = {}
        for tid, stops in trip_stops.items():
            stops.sort()
            stop_ids = [s[1] for s in stops]
            if "ARLINGTNHT" not in stop_ids:
                continue
            aidx = stop_ids.index("ARLINGTNHT")
            if "OTC" not in stop_ids[aidx + 1:]:
                continue  # outbound — OTC must come after Arlington
            dep_secs = stops[aidx][2]
            # Clybourn arrival (first occurrence after Arlington Heights)
            clybourn_secs = None
            for j in range(aidx + 1, len(stops)):
                if stop_ids[j] == "CLYBOURN":
                    clybourn_secs = stops[j][2]
                    break
            arlington_deps[tid] = {
                "service_id": upnw_trips[tid],
                "dep_secs":      dep_secs,
                "clybourn_secs": clybourn_secs,
            }

        # 4. Service calendar
        service_days = {}  # service_id -> list of weekday ints (0=Mon)
        try:
            day_cols = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]
            for row in gtfs_reader(zf, "calendar.txt"):
                days = [i for i, col in enumerate(day_cols) if row.get(col) == "1"]
                service_days[row["service_id"]] = days
        except KeyError:
            pass

        # 5. Calendar exceptions (added=1, removed=2)
        service_exceptions = {}  # "service_id|YYYYMMDD" -> 1 or 2
        try:
            for row in gtfs_reader(zf, "calendar_dates.txt"):
                service_exceptions[f"{row['service_id']}|{row['date']}"] = int(row["exception_type"])
        except KeyError:
            pass

        result = {
            "clybourn_deps": clybourn_deps,
            "arlington_deps": arlington_deps,
            "service_days": service_days,
            "service_exceptions": service_exceptions,
            "updatedAt": now_iso(),
        }
        write_json_atomic(METRA_SCHEDULE_CACHE, result)
        print(f"Metra schedule: {len(clybourn_deps)} outbound Clybourn, {len(arlington_deps)} inbound Arlington trips cached.")

        _metra_schedule = result
        _metra_schedule_loaded_at = time.time()
        return result

    except Exception as e:
        print(f"Metra schedule error: {e}")
        return None


def _filter_schedule_for_today(sched, key):
    """Return today's running trips from sched[key], keyed by trip_id."""
    now = datetime.datetime.now()
    weekday   = now.weekday()
    today_str = now.strftime("%Y%m%d")
    result = {}
    for tid, info in sched.get(key, {}).items():
        sid = info["service_id"]
        exc = sched["service_exceptions"].get(f"{sid}|{today_str}")
        if exc == 2:
            continue
        runs = True if exc == 1 else weekday in sched["service_days"].get(sid, [])
        if runs:
            result[tid] = info
    return result


def get_scheduled_clybourn_deps():
    """Return today's outbound UP-NW trips departing Clybourn."""
    sched = load_metra_static_schedule()
    return _filter_schedule_for_today(sched, "clybourn_deps") if sched else {}


def get_scheduled_arlington_deps():
    """Return today's inbound UP-NW trips departing Arlington Heights toward OTC."""
    sched = load_metra_static_schedule()
    if not sched:
        return {}
    # Old cache won't have arlington_deps — force a refresh once
    if "arlington_deps" not in sched:
        sched = load_metra_static_schedule(force=True)
        if not sched:
            return {}
    return _filter_schedule_for_today(sched, "arlington_deps")


def fetch_metra_clybourn():
    if not METRA_KEY:
        return {"rows": [], "error": "Missing METRA_KEY", "updatedAt": now_iso()}

    try:
        from google.transit import gtfs_realtime_pb2

        # --- Static schedule: today's outbound Clybourn departures ---
        scheduled = get_scheduled_clybourn_deps()  # trip_id -> {dep_secs, terminal}

        now_dt  = datetime.datetime.now()
        now_ts  = time.time()
        midnight = now_dt.replace(hour=0, minute=0, second=0, microsecond=0)

        # --- Real-time feed: build delay map ---
        url = f"https://gtfspublic.metrarr.com/gtfs/public/tripupdates?api_token={METRA_KEY}"
        req = Request(url, headers={"User-Agent": "ctatracker-local/1.0"})
        ctx = ssl.create_default_context() if VERIFY_SSL else ssl._create_unverified_context()
        with urlopen(req, timeout=12, context=ctx) as resp:
            raw = resp.read()

        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(raw)

        # trip_id -> {dep_time (unix), canceled}
        realtime = {}
        for entity in feed.entity:
            tu = entity.trip_update
            if tu.trip.route_id != "UP-NW":
                continue
            tid = tu.trip.trip_id
            stop_ids = [s.stop_id for s in tu.stop_time_update]

            # Canceled trip
            if tu.trip.schedule_relationship == 3:
                realtime[tid] = {"canceled": True}
                continue

            if "CLYBOURN" not in stop_ids:
                continue
            idx = stop_ids.index("CLYBOURN")
            if "OTC" in stop_ids[idx + 1:]:
                continue  # inbound
            cly = tu.stop_time_update[idx]
            dep_time = cly.departure.time or cly.arrival.time
            realtime[tid] = {"dep_time": dep_time, "canceled": False}

        # --- Merge ---
        results = []
        for tid, info in scheduled.items():
            rt = realtime.get(tid, {})
            if rt.get("canceled"):
                continue

            # Use real-time time if available, else scheduled
            rt_dep = rt.get("dep_time")
            if rt_dep:
                dep_unix = rt_dep
            else:
                dep_unix = midnight.timestamp() + info["dep_secs"]

            if dep_unix < now_ts - 30:
                continue

            arlington_secs = info.get("arlington_secs")
            arlington_mins = None
            if arlington_secs is not None:
                arlington_mins = round((arlington_secs - info["dep_secs"]) / 60)

            results.append({
                "tripId": tid,
                "depTime": dep_unix,
                "mins": max(0, round((dep_unix - now_ts) / 60)),
                "terminal": info["terminal"],
                "realtime": bool(rt_dep),
                "arlingtonMins": arlington_mins,
            })

        results.sort(key=lambda x: x["depTime"])

        # Deduplicate: same dep time + terminal = same train (multiple schedule variants)
        seen = set()
        deduped = []
        for r in results:
            key = (round(r["depTime"]), r["terminal"])
            if key not in seen:
                seen.add(key)
                deduped.append(r)

        return {"rows": deduped[:6], "error": None, "updatedAt": now_iso()}

    except Exception as e:
        return {"rows": [], "error": str(e), "updatedAt": now_iso()}


# ===== Commute =====

def ntfy_publish(message, title=None, tags=None, priority=None):
    """Publish to the ntfy topic. Returns True on success. Never raises — a
    failed notification must not take the poll loop down."""
    if not (NTFY_URL and NTFY_TOPIC):
        return False
    headers = {"Content-Type": "text/plain; charset=utf-8"}
    if NTFY_TOKEN:
        headers["Authorization"] = f"Bearer {NTFY_TOKEN}"
    if title:
        headers["Title"] = title
    if tags:
        headers["Tags"] = tags
    if priority:
        headers["Priority"] = str(priority)
    try:
        req = Request(
            f"{NTFY_URL.rstrip('/')}/{NTFY_TOPIC}",
            data=message.encode("utf-8"),
            headers=headers,
            method="POST",
        )
        ctx = ssl.create_default_context() if VERIFY_SSL else ssl._create_unverified_context()
        with urlopen(req, timeout=10, context=ctx) as resp:
            return 200 <= resp.status < 300
    except Exception as e:
        print(f"ntfy publish error: {e}")
        return False


def fetch_presence_location():
    """'home' | 'work' | 'away' | 'unknown'. Falls back to 'unknown' so a
    presence outage silences alerts rather than firing the wrong direction."""
    try:
        data = http_get_json(PRESENCE_URL, timeout=6)
    except Exception:
        return "unknown"
    location = data.get("location")
    if location:
        return location
    return "home" if data.get("home") else "away"  # pre-location payload


def _metra_realtime_deps(station, want_inbound):
    """trip_id -> {"dep_time": unix|None, "canceled": bool} for UP-NW trains
    calling at `station`, in one direction. Direction is inferred the same way
    fetch_metra_clybourn() does it: OTC appearing after the station means the
    train is heading into the city."""
    from google.transit import gtfs_realtime_pb2

    url = f"https://gtfspublic.metrarr.com/gtfs/public/tripupdates?api_token={METRA_KEY}"
    req = Request(url, headers={"User-Agent": "ctatracker-local/1.0"})
    ctx = ssl.create_default_context() if VERIFY_SSL else ssl._create_unverified_context()
    with urlopen(req, timeout=12, context=ctx) as resp:
        raw = resp.read()

    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(raw)

    out = {}
    for entity in feed.entity:
        tu = entity.trip_update
        if tu.trip.route_id != "UP-NW":
            continue
        tid = tu.trip.trip_id
        if tu.trip.schedule_relationship == 3:
            out[tid] = {"dep_time": None, "canceled": True}
            continue
        stop_ids = [s.stop_id for s in tu.stop_time_update]
        if station not in stop_ids:
            continue
        idx = stop_ids.index(station)
        if ("OTC" in stop_ids[idx + 1:]) != want_inbound:
            continue
        st = tu.stop_time_update[idx]
        out[tid] = {"dep_time": st.departure.time or st.arrival.time, "canceled": False}
    return out


def _load_delay_state():
    """{"date": "YYYYMMDD", "alerted": {trip_id: minutes_late|"canceled"}}.
    Keyed by date so it self-cleans at midnight instead of growing forever."""
    today = datetime.datetime.now().strftime("%Y%m%d")
    try:
        with open(DELAY_STATE_FILE) as f:
            state = json.load(f)
        if state.get("date") == today:
            return state
    except (FileNotFoundError, ValueError, json.JSONDecodeError):
        pass
    return {"date": today, "alerted": {}}


def check_metra_delays():
    """Push a notification when an upcoming UP-NW train in the direction we're
    about to travel is more than DELAY_THRESHOLD_MIN late, or cancelled."""
    if not (METRA_KEY and NTFY_TOPIC):
        return

    location = fetch_presence_location()
    if location == "home":
        # Next trip is outbound: Clybourn -> Arlington Heights.
        scheduled, station, inbound, heading = (
            get_scheduled_clybourn_deps(), "CLYBOURN", False, "from Clybourn")
    elif location == "work":
        # Next trip is inbound: Arlington Heights -> Clybourn.
        scheduled, station, inbound, heading = (
            get_scheduled_arlington_deps(), "ARLINGTNHT", True, "from Arlington Heights")
    else:
        return  # commuting or unknown — nothing actionable to say

    if not scheduled:
        return

    realtime = _metra_realtime_deps(station, inbound)
    now_ts   = time.time()
    midnight = datetime.datetime.now().replace(
        hour=0, minute=0, second=0, microsecond=0).timestamp()

    state   = _load_delay_state()
    alerted = state["alerted"]
    lines   = []

    for tid, info in scheduled.items():
        sched_unix = midnight + info["dep_secs"]
        # Only trains that haven't left yet and are within the lookahead.
        if not (now_ts - 60 <= sched_unix <= now_ts + DELAY_LOOKAHEAD_MIN * 60):
            continue
        rt = realtime.get(tid)
        if not rt:
            continue

        sched_hm = datetime.datetime.fromtimestamp(sched_unix).strftime("%-I:%M")

        if rt["canceled"]:
            if alerted.get(tid) != "canceled":
                lines.append(f"{sched_hm} {heading} is CANCELLED")
                alerted[tid] = "canceled"
            continue

        if not rt["dep_time"]:
            continue
        late_min = round((rt["dep_time"] - sched_unix) / 60)
        if late_min < DELAY_THRESHOLD_MIN:
            continue

        prev = alerted.get(tid)
        # Re-alert only if it has slipped meaningfully further since last time.
        if isinstance(prev, int) and late_min < prev + DELAY_REALERT_MIN:
            continue

        new_hm = datetime.datetime.fromtimestamp(rt["dep_time"]).strftime("%-I:%M")
        lines.append(f"{sched_hm} {heading} is {late_min} min late (now {new_hm})")
        alerted[tid] = late_min

    if not lines:
        return

    if ntfy_publish(
        "\n".join(lines),
        title="Metra delay" if len(lines) == 1 else f"Metra delays ({len(lines)})",
        tags="train",
    ):
        state["alerted"] = alerted
        write_json_atomic(DELAY_STATE_FILE, state)
        print(f"[delays] notified: {' | '.join(lines)}")


def fetch_commute():
    if not GOOGLE_API_KEY:
        return {"error": "Missing GOOGLE_API_KEY", "updatedAt": now_iso()}
    try:
        data = http_post_json(
            "https://routes.googleapis.com/directions/v2:computeRoutes",
            {
                "origin": {"address": COMMUTE_ORIGIN},
                "destination": {"address": COMMUTE_DESTINATION},
                "travelMode": "DRIVE",
                "routingPreference": "TRAFFIC_AWARE",
            },
            headers={
                "Content-Type": "application/json",
                "X-Goog-Api-Key": GOOGLE_API_KEY,
                "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters",
            },
        )
        route = data["routes"][0]
        duration_secs = int(route["duration"].rstrip("s"))
        static_secs   = int(route["staticDuration"].rstrip("s"))
        return {
            "duration_minutes": round(duration_secs / 60),
            "static_minutes":   round(static_secs / 60),
            "distance_miles":   round(route["distanceMeters"] / 1609.34, 1),
            "error": None,
            "updatedAt": now_iso(),
        }
    except Exception as e:
        return {"error": str(e), "updatedAt": now_iso()}


def fetch_commute_return():
    if not GOOGLE_API_KEY:
        return {"error": "Missing GOOGLE_API_KEY", "updatedAt": now_iso()}
    try:
        data = http_post_json(
            "https://routes.googleapis.com/directions/v2:computeRoutes",
            {
                "origin": {"address": COMMUTE_RETURN_ORIGIN},
                "destination": {"address": COMMUTE_RETURN_DESTINATION},
                "travelMode": "DRIVE",
                "routingPreference": "TRAFFIC_AWARE",
                "extraComputations": ["TRAFFIC_ON_POLYLINE"],
            },
            headers={
                "Content-Type": "application/json",
                "X-Goog-Api-Key": GOOGLE_API_KEY,
                "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters",
            },
        )
        route = data["routes"][0]
        duration_secs = int(route["duration"].rstrip("s"))
        static_secs   = int(route["staticDuration"].rstrip("s"))
        return {
            "duration_minutes": round(duration_secs / 60),
            "static_minutes":   round(static_secs / 60),
            "distance_miles":   round(route["distanceMeters"] / 1609.34, 1),
            "error": None,
            "updatedAt": now_iso(),
        }
    except Exception as e:
        return {"error": str(e), "updatedAt": now_iso()}


def log_commute_return_datapoint(commute):
    """Append one JSON line to commute_return_log.jsonl for later analysis."""
    try:
        # Next inbound Arlington Heights departure (static schedule)
        arlington = get_scheduled_arlington_deps()
        now_ts = time.time()
        midnight = datetime.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

        next_train = None
        for info in sorted(arlington.values(), key=lambda x: x["dep_secs"]):
            dep_unix = midnight.timestamp() + info["dep_secs"]
            if dep_unix >= now_ts - 30:
                ride_mins = None
                if info.get("clybourn_secs") is not None:
                    ride_mins = round((info["clybourn_secs"] - info["dep_secs"]) / 60)
                next_train = {
                    "mins": max(0, round((dep_unix - now_ts) / 60)),
                    "ride_mins": ride_mins,
                }
                break

        metra_total = (
            (next_train["mins"] or 0) + (next_train["ride_mins"] or 0)
        ) if next_train and next_train["ride_mins"] is not None else None

        point = {
            "ts": now_iso(),
            "drive_mins": commute.get("duration_minutes"),
            "drive_static_mins": commute.get("static_minutes"),
            "drive_miles": commute.get("distance_miles"),
            "metra_departs_in_mins": next_train["mins"] if next_train else None,
            "metra_ride_mins": next_train["ride_mins"] if next_train else None,
            "metra_total_mins": metra_total,
        }
        append_jsonl(os.path.join(DATA_DIR, "commute_return_log.jsonl"), point)
    except Exception as e:
        print(f"Return commute log error: {e}")


def log_commute_datapoint(commute):
    """Append one JSON line to commute_log.jsonl for later analysis."""
    try:
        metra = {}
        try:
            with open(os.path.join(DATA_DIR, "metra_clybourn.json")) as f:
                metra = json.load(f)
        except Exception:
            pass

        next_train = next((r for r in metra.get("rows", []) if r.get("arlingtonMins") is not None), None)

        layout      = read_layout()
        mpg         = layout.get("mpg", 28)
        gas_price   = layout.get("gasPrice", 3.50)
        toll_cost   = layout.get("tollCost", 0)
        metra_fare  = layout.get("metraFare", 5.50)
        metra_pass  = layout.get("metraDayPass", 10.00)
        ticket_mode = layout.get("metraTicketMode", "roundtrip")
        dist        = commute.get("distance_miles")
        gas_cost    = round((dist / mpg) * gas_price * 2, 2) if dist else None
        drive_cost  = round(gas_cost + toll_cost, 2) if gas_cost is not None else None
        metra_cost  = metra_pass if ticket_mode == "daypass" else round(metra_fare * 2, 2)

        point = {
            "ts": now_iso(),
            "drive_mins": commute.get("duration_minutes"),
            "drive_static_mins": commute.get("static_minutes"),
            "drive_miles": dist,
            "drive_cost_usd": drive_cost,
            "drive_gas_usd": gas_cost,
            "drive_toll_usd": toll_cost if toll_cost else None,
            "metra_cost_usd": metra_cost,
            "metra_ticket_mode": ticket_mode,
            "metra_departs_in_mins": next_train.get("mins") if next_train else None,
            "metra_arlington_ride_mins": next_train.get("arlingtonMins") if next_train else None,
            "metra_total_mins": (
                (next_train.get("mins") or 0) + (next_train.get("arlingtonMins") or 0)
            ) if next_train else None,
        }

        append_jsonl(os.path.join(DATA_DIR, "commute_log.jsonl"), point)
    except Exception as e:
        print(f"Commute log error: {e}")


# ===== ESPN Sports =====

def format_central_datetime(iso_str):
    """Parse ESPN ISO date string, return (date_text, time_text) in Central time.
    Pi is set to Central timezone so we use local time."""
    from datetime import datetime as dt, timezone
    try:
        # ESPN dates are like "2025-01-15T00:00Z" or "2025-01-15T19:30:00Z"
        s = iso_str.replace("Z", "+00:00")
        d = dt.fromisoformat(s)
        # Convert to local time (Pi is Central)
        local = d.astimezone()
        date_text = local.strftime("%a, %b %-d")  # "Fri, Nov 14"
        time_text = local.strftime("%-I:%M %p")    # "7:00 PM"
        return date_text, time_text
    except Exception:
        return "", ""


def extract_score(competitor):
    """Port of the JS cascade: check score field, then linescores, then statistics."""
    if not competitor:
        return None

    score = competitor.get("score")
    if score is not None:
        if isinstance(score, (str, int, float)):
            try:
                n = int(score)
                return n
            except (ValueError, TypeError):
                pass
        elif isinstance(score, dict):
            for key in ("value", "displayValue", "score", "text"):
                cand = score.get(key)
                if cand is not None:
                    try:
                        return int(str(cand))
                    except (ValueError, TypeError):
                        continue

    lines = competitor.get("linescores") or competitor.get("lineScores") or []
    if isinstance(lines, list) and lines:
        total = 0
        found = False
        for ls in lines:
            if not isinstance(ls, dict):
                continue
            v = None
            for key in ("value", "score", "displayValue", "points"):
                v = ls.get(key)
                if v is not None:
                    break
            if v is None:
                stats = ls.get("statistics")
                if isinstance(stats, list) and stats:
                    v = stats[0].get("value") if isinstance(stats[0], dict) else None
            if v is not None:
                try:
                    total += int(str(v))
                    found = True
                except (ValueError, TypeError):
                    continue
        if found:
            return total

    stats = competitor.get("statistics") or competitor.get("stats") or []
    if isinstance(stats, list):
        for s in stats:
            if not isinstance(s, dict):
                continue
            label = (s.get("name") or s.get("label") or s.get("abbreviation") or "").lower()
            if "point" in label or label == "pts" or label == "score":
                v = s.get("value") if s.get("value") is not None else s.get("displayValue")
                if v is not None:
                    try:
                        return int(str(v))
                    except (ValueError, TypeError):
                        continue

    return None


def map_espn_event(event, is_our_team):
    """Core logic: returns dict with 'live' and 'next' based on game state."""
    if not event or not event.get("competitions"):
        return {"live": None, "next": None}

    comp = event["competitions"][0]
    competitors = comp.get("competitors") or []

    us = None
    them = None
    for c in competitors:
        if is_our_team(c):
            us = c
        else:
            them = c

    if not us or not them:
        return {"live": None, "next": None}

    is_home = us.get("homeAway") == "home"

    status_obj = {}
    if comp.get("status") and comp["status"].get("type"):
        status_obj = comp["status"]["type"]
    elif event.get("status") and event["status"].get("type"):
        status_obj = event["status"]["type"]

    raw_state = (status_obj.get("state") or "").lower()

    period_number = None
    if comp.get("status") and isinstance(comp["status"].get("period"), int):
        period_number = comp["status"]["period"]
    elif isinstance(status_obj.get("period"), int):
        period_number = status_obj["period"]

    period = ""
    if isinstance(period_number, int) and period_number > 0:
        period = f"Q{period_number}"

    clock = ""
    if comp.get("status") and comp["status"].get("displayClock"):
        clock = comp["status"]["displayClock"]
    elif status_obj.get("displayClock"):
        clock = status_obj["displayClock"]

    us_score = extract_score(us)
    them_score = extract_score(them)

    date_text, time_text = format_central_datetime(event.get("date", ""))

    team_info = them.get("team") or {}
    opponent_name = (team_info.get("displayName")
                     or team_info.get("shortDisplayName")
                     or team_info.get("name")
                     or "Opponent")

    logos = team_info.get("logos") or []
    if isinstance(logos, list) and logos:
        opponent_logo = logos[0].get("href") if isinstance(logos[0], dict) else None
    else:
        opponent_logo = team_info.get("logo")

    home_away = "vs" if is_home else "@"

    if raw_state == "in":
        return {
            "live": {
                "opponentName": opponent_name,
                "opponentLogo": opponent_logo,
                "usScore": us_score,
                "themScore": them_score,
                "period": period or status_obj.get("shortDetail", ""),
                "clock": clock,
                "homeAway": home_away,
            },
            "next": None,
        }

    if raw_state == "post":
        return {
            "live": {
                "opponentName": opponent_name,
                "opponentLogo": opponent_logo,
                "usScore": us_score,
                "themScore": them_score,
                "period": "F",
                "clock": "",
                "homeAway": home_away,
            },
            "next": None,
        }

    # pre or unknown → next game
    return {
        "live": None,
        "next": {
            "opponentName": opponent_name,
            "opponentLogo": opponent_logo,
            "date": date_text,
            "time": time_text,
            "homeAway": home_away,
        },
    }


def get_first_next_event(team_json):
    """Extract the first nextEvent from team endpoint response."""
    team = team_json.get("team") or {}
    arr = team.get("nextEvent") or []
    if not isinstance(arr, list) or not arr:
        return None
    for ev in arr:
        if ev.get("competitions"):
            return ev
    return None


def is_bulls(c):
    team = c.get("team") or {}
    name = team.get("displayName") or team.get("name") or ""
    short = team.get("shortDisplayName") or team.get("abbreviation") or ""
    return name == "Chicago Bulls" or short == "CHI"


def is_bears(c):
    team = c.get("team") or {}
    name = team.get("displayName") or team.get("name") or ""
    short = team.get("shortDisplayName") or team.get("abbreviation") or ""
    return name == "Chicago Bears" or short == "CHI"


def is_creighton(c):
    team = c.get("team") or {}
    name = team.get("displayName") or team.get("name") or ""
    short = team.get("shortDisplayName") or team.get("abbreviation") or ""
    return "Creighton" in name or short == "CREI"


def fetch_team_status(scoreboard_url, team_url, is_our_team, fallback_msg=None):
    """Generic ESPN fetch: try scoreboard first, fall back to team endpoint."""
    # Try scoreboard
    try:
        sb = http_get_json(scoreboard_url)
        events = sb.get("events") or []
        for ev in events:
            comp = ev.get("competitions") and ev["competitions"][0]
            if not comp or not comp.get("competitors"):
                continue
            if any(is_our_team(c) for c in comp["competitors"]):
                return map_espn_event(ev, is_our_team)
    except Exception as e:
        print(f"ESPN scoreboard error: {e}")

    # Fall back to team endpoint
    try:
        team_json = http_get_json(team_url)
        next_event = get_first_next_event(team_json)
        if next_event:
            return map_espn_event(next_event, is_our_team)
    except Exception as e:
        print(f"ESPN team endpoint error: {e}")

    if fallback_msg:
        return {
            "live": None,
            "next": {
                "opponentName": fallback_msg,
                "opponentLogo": None,
                "date": "",
                "time": "",
                "homeAway": "vs",
            },
        }

    return {"live": None, "next": None}


def fetch_bulls():
    return fetch_team_status(ESPN_NBA_SCOREBOARD, ESPN_BULLS_TEAM, is_bulls)


def fetch_bears():
    return fetch_team_status(ESPN_NFL_SCOREBOARD, ESPN_BEARS_TEAM, is_bears, "Season complete")


def fetch_creighton():
    return fetch_team_status(ESPN_NCAAM_SCOREBOARD, ESPN_CREIGHTON_TEAM, is_creighton, "Season complete")


# ===== Latest Activity (fitness-logger on the home server) =====

# fitness-logger slugs → the kinds index.html renders ("golf" predates the slug)
KIND_OVERRIDES = {"golfing": "golf"}


def fetch_latest_activity():
    if not FITNESS_URL or not FITNESS_TOKEN:
        return {"log": None, "location": None, "error": "Missing fitness-logger config", "updatedAt": now_iso()}

    try:
        payload = http_get_json(
            f"{FITNESS_URL}/api/latest-activity",
            headers={"Authorization": f"Bearer {FITNESS_TOKEN}"},
        )
        log = payload.get("log")
        if not log:
            return {"log": None, "location": None, "updatedAt": now_iso()}

        slug = log.get("slug") or ""
        log["_kind"] = KIND_OVERRIDES.get(slug, slug or "unknown")
        return {"log": log, "location": payload.get("location"), "updatedAt": now_iso()}

    except Exception as e:
        return {"log": None, "location": None, "error": str(e), "updatedAt": now_iso()}


# ===== Poll loops =====

def read_layout():
    # Layout lives on the Pi (the phone control panel writes it there); fall
    # back to the local copy if the Pi is unreachable.
    try:
        return http_get_json(f"{PI_BASE_URL}/api/layout", timeout=6)
    except Exception:
        pass
    try:
        with open(os.path.join(DATA_DIR, "layout.json")) as f:
            return json.load(f)
    except Exception:
        return {}


def poll_transit():
    layout    = read_layout()
    auto_swap = layout.get("autoKimballMetra", True)
    empty     = {"rows": [], "error": None, "updatedAt": now_iso()}

    # Trains: needed if loop or kimball is on, or auto-swap could show kimball
    if layout.get("trainLoop", True) or layout.get("trainKimball", True) or auto_swap:
        train = fetch_cta_trains("40360")
    else:
        train = empty
    write_json_atomic(os.path.join(DATA_DIR, "train.json"), train)

    if layout.get("busEast", True):
        bus_e = fetch_cta_bus_predictions("17833", rt="77", top="6")
    else:
        bus_e = empty
    write_json_atomic(os.path.join(DATA_DIR, "bus_east.json"), bus_e)

    if layout.get("busWest", True):
        bus_w = fetch_cta_bus_predictions("14920", rt="77", top="6")
    else:
        bus_w = empty
    write_json_atomic(os.path.join(DATA_DIR, "bus_west.json"), bus_w)

    # Metra: needed if explicitly on, or auto-swap could show it during weekday AM
    if layout.get("metraClybourn", False) or auto_swap:
        metra = fetch_metra_clybourn()
    else:
        metra = empty
    write_json_atomic(os.path.join(DATA_DIR, "metra_clybourn.json"), metra)

    if layout.get("nowPlaying", True):
        try:
            now_playing = http_get_json(f"{PI_BASE_URL}/api/sonos/now-playing")
            now_playing["updatedAt"] = now_iso()
        except Exception as e:
            now_playing = {"playing": False, "error": str(e), "updatedAt": now_iso()}
    else:
        now_playing = {"playing": False, "updatedAt": now_iso()}
    write_json_atomic(os.path.join(DATA_DIR, "now_playing.json"), now_playing)


def poll_sports():
    layout = read_layout()
    if not layout.get("sports", True):
        return

    for name, fetcher in [("bulls", fetch_bulls), ("bears", fetch_bears), ("creighton", fetch_creighton)]:
        try:
            data = fetcher()
            data["updatedAt"] = now_iso()
            write_json_atomic(os.path.join(DATA_DIR, f"sports_{name}.json"), data)
        except Exception as e:
            print(f"Sports error ({name}): {e}")
            write_json_atomic(os.path.join(DATA_DIR, f"sports_{name}.json"),
                              {"live": None, "next": None, "updatedAt": now_iso()})


def main():
    ensure_dir(DATA_DIR)

    last_sports   = 0
    last_commute  = 0
    last_activity = 0
    last_delays   = 0

    print("Poller started:", now_iso())

    while True:
        try:
            poll_transit()
        except Exception as e:
            print(f"Transit poll error: {e}")

        now = time.time()
        if now - last_sports >= SPORTS_INTERVAL:
            try:
                poll_sports()
            except Exception as e:
                print(f"Sports poll error: {e}")
            last_sports = now

        if now - last_commute >= COMMUTE_INTERVAL:
            layout = read_layout()
            now_dt = datetime.datetime.now()
            if layout.get("commute", True) and is_weekday_morning():
                try:
                    commute = fetch_commute()
                    write_json_atomic(os.path.join(DATA_DIR, "commute.json"), commute)
                except Exception as e:
                    print(f"Commute poll error: {e}")
            last_commute = now

        if now - last_delays >= DELAY_INTERVAL:
            try:
                check_metra_delays()
            except Exception as e:
                print(f"Delay check error: {e}")
            last_delays = now

        if now - last_activity >= ACTIVITY_INTERVAL:
            layout = read_layout()
            if layout.get("latestActivity", True):
                try:
                    activity = fetch_latest_activity()
                    write_json_atomic(os.path.join(DATA_DIR, "latest_activity.json"), activity)
                except Exception as e:
                    print(f"Activity poll error: {e}")
            last_activity = now

        print("Updated:", now_iso())
        time.sleep(TRANSIT_INTERVAL)


if __name__ == "__main__":
    main()
