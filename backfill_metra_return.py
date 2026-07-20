#!/usr/bin/env python3
"""
One-off script: backfill metra_total_mins into commute_return_log.jsonl
for entries that are missing it, using the cached static schedule.
"""
import os, json, datetime

ROOT     = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
LOG_FILE = os.path.join(DATA_DIR, "commute_return_log.jsonl")
CACHE    = os.path.join(DATA_DIR, "metra_schedule_cache.json")

# Load schedule cache
with open(CACHE) as f:
    sched = json.load(f)

arlington_deps  = sched.get("arlington_deps", {})
service_days    = sched.get("service_days", {})
service_excepts = sched.get("service_exceptions", {})

def trips_for_date(dt):
    weekday   = dt.weekday()
    today_str = dt.strftime("%Y%m%d")
    result = []
    for tid, info in arlington_deps.items():
        sid = info["service_id"]
        exc = service_excepts.get(f"{sid}|{today_str}")
        if exc == 2:
            continue
        runs = True if exc == 1 else weekday in service_days.get(sid, [])
        if runs:
            result.append(info)
    result.sort(key=lambda x: x["dep_secs"])
    return result

def next_train_at(ts_str):
    dt       = datetime.datetime.strptime(ts_str, "%Y-%m-%dT%H:%M:%S")
    midnight = dt.replace(hour=0, minute=0, second=0, microsecond=0)
    now_secs = (dt - midnight).total_seconds()

    for info in trips_for_date(dt):
        if info["dep_secs"] >= now_secs - 30:
            ride_mins = None
            if info.get("clybourn_secs") is not None:
                ride_mins = round((info["clybourn_secs"] - info["dep_secs"]) / 60)
            departs_in = max(0, round((info["dep_secs"] - now_secs) / 60))
            metra_total = (departs_in + ride_mins) if ride_mins is not None else None
            return {
                "metra_departs_in_mins": departs_in,
                "metra_ride_mins":       ride_mins,
                "metra_total_mins":      metra_total,
            }
    return {"metra_departs_in_mins": None, "metra_ride_mins": None, "metra_total_mins": None}

# Read, patch, rewrite
with open(LOG_FILE) as f:
    lines = [l for l in f.read().splitlines() if l.strip()]

updated = 0
patched = []
for line in lines:
    entry = json.loads(line)
    if entry.get("metra_total_mins") is None and entry.get("ts"):
        metra = next_train_at(entry["ts"])
        entry.update(metra)
        updated += 1
    patched.append(json.dumps(entry))

with open(LOG_FILE, "w") as f:
    f.write("\n".join(patched) + "\n")

print(f"Done. Patched {updated} of {len(patched)} entries.")
