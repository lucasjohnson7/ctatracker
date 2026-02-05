#!/usr/bin/env python3
from __future__ import print_function

import os
import json
import time
import datetime
import ssl

try:
    # Python 3.4
    from urllib.request import urlopen, Request
except ImportError:
    from urllib2 import urlopen, Request

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")

CTA_TRAIN_KEY = os.environ.get("CTA_TRAIN_KEY", "")
CTA_BUS_KEY = os.environ.get("CTA_BUS_KEY", "")

REFRESH_SECONDS = 20

# If you still get CERTIFICATE_VERIFY_FAILED even after fixing CA certs,
# set VERIFY_SSL=0 before running poller.py to disable verification (not ideal, but works).
VERIFY_SSL = os.environ.get("VERIFY_SSL", "1") != "0"


def now_iso():
    return datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def ensure_dir(path):
    if not os.path.isdir(path):
        os.makedirs(path)


def write_json_atomic(filepath, obj):
    tmp = filepath + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f)
    os.rename(tmp, filepath)


def http_get_json(url, headers=None, timeout=12):
    hdrs = headers or {}
    req = Request(url, headers=hdrs)

    if VERIFY_SSL:
        ctx = ssl.create_default_context()
    else:
        ctx = ssl._create_unverified_context()

    with urlopen(req, timeout=timeout, context=ctx) as resp:
        raw = resp.read().decode("utf-8", "replace")
        return json.loads(raw)


def fetch_cta_trains(mapid):
    if not CTA_TRAIN_KEY:
        return {"rows": [], "error": "Missing CTA_TRAIN_KEY", "updatedAt": now_iso()}

    url = (
        "https://lapi.transitchicago.com/api/1.0/ttarrivals.aspx"
        "?key={key}&mapid={mapid}&outputType=JSON"
    ).format(key=CTA_TRAIN_KEY, mapid=mapid)

    try:
        j = http_get_json(url, timeout=12)
        rows = (((j.get("ctatt") or {}).get("eta")) or [])
        cleaned = []
        for x in rows:
            cleaned.append({
                "rn": x.get("rn"),
                "destNm": x.get("destNm"),
                "stpDe": x.get("stpDe"),
                "arrT": x.get("arrT"),
            })
        return {"rows": cleaned, "error": None, "updatedAt": now_iso()}
    except Exception as e:
        return {"rows": [], "error": str(e), "updatedAt": now_iso()}


def fetch_cta_bus_predictions(stpid, rt="77", top="6"):
    if not CTA_BUS_KEY:
        return {"rows": [], "error": "Missing CTA_BUS_KEY", "updatedAt": now_iso()}
    if not stpid:
        return {"rows": [], "error": "Missing stpid", "updatedAt": now_iso()}

    url = (
        "https://www.ctabustracker.com/bustime/api/v3/getpredictions"
        "?format=json&key={key}&rt={rt}&stpid={stpid}&top={top}"
    ).format(key=CTA_BUS_KEY, rt=rt, stpid=stpid, top=top)

    try:
        j = http_get_json(url, headers={"User-Agent": "ctatracker-local/1.0"}, timeout=12)

        root = j.get("bustime-response")
        if root is None:
            root = j.get("bustime_response")
        if root is None:
            root = {}

        api_err = None
        if root.get("error"):
            try:
                api_err = (root["error"][0] or {}).get("msg")
            except Exception:
                api_err = "Unknown CTA bus error"

        rows = root.get("prd") or []
        return {"rows": rows, "error": api_err, "updatedAt": now_iso()}
    except Exception as e:
        return {"rows": [], "error": str(e), "updatedAt": now_iso()}


def main():
    ensure_dir(DATA_DIR)
    print("Poller running. Writing JSON to:", DATA_DIR)

    while True:
        train = fetch_cta_trains("40360")
        write_json_atomic(os.path.join(DATA_DIR, "train.json"), train)

        bus_e = fetch_cta_bus_predictions("17833", rt="77", top="6")
        write_json_atomic(os.path.join(DATA_DIR, "bus_east.json"), bus_e)

        bus_w = fetch_cta_bus_predictions("14920", rt="77", top="6")
        write_json_atomic(os.path.join(DATA_DIR, "bus_west.json"), bus_w)

        # placeholders so frontend stays stable
        write_json_atomic(os.path.join(DATA_DIR, "sports_creighton.json"), {"live": None, "next": None, "updatedAt": now_iso()})
        write_json_atomic(os.path.join(DATA_DIR, "sports_bulls.json"), {"live": None, "next": None, "updatedAt": now_iso()})
        write_json_atomic(os.path.join(DATA_DIR, "sports_bears.json"), {"live": None, "next": None, "updatedAt": now_iso()})
        write_json_atomic(os.path.join(DATA_DIR, "now_playing.json"), {"playing": False, "updatedAt": now_iso()})

        print("Updated:", now_iso())
        time.sleep(REFRESH_SECONDS)


if __name__ == "__main__":
    main()
