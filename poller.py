#!/usr/bin/env python3

import os
import json
import datetime
import ssl
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

CTA_TRAIN_KEY = os.environ.get("CTA_TRAIN_KEY", "")
CTA_BUS_KEY   = os.environ.get("CTA_BUS_KEY", "")

# Set VERIFY_SSL=0 in env if certs ever break
VERIFY_SSL = os.environ.get("VERIFY_SSL", "1") != "0"


def now_iso():
    return datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def ensure_dir(path):
    os.makedirs(path, exist_ok=True)


def write_json_atomic(filepath, obj):
    tmp = filepath + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f)
    os.replace(tmp, filepath)


def http_get_json(url, headers=None, timeout=12):
    req = Request(url, headers=headers or {})

    ctx = ssl.create_default_context() if VERIFY_SSL else ssl._create_unverified_context()

    with urlopen(req, timeout=timeout, context=ctx) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


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

def main():
    ensure_dir(DATA_DIR)

    train = fetch_cta_trains("40360")
    write_json_atomic(os.path.join(DATA_DIR, "train.json"), train)

    bus_e = fetch_cta_bus_predictions("17833", rt="77", top="6")
    write_json_atomic(os.path.join(DATA_DIR, "bus_east.json"), bus_e)

    bus_w = fetch_cta_bus_predictions("14920", rt="77", top="6")
    write_json_atomic(os.path.join(DATA_DIR, "bus_west.json"), bus_w)

    write_json_atomic(os.path.join(DATA_DIR, "sports_creighton.json"), {"live": None, "next": None, "updatedAt": now_iso()})
    write_json_atomic(os.path.join(DATA_DIR, "sports_bulls.json"), {"live": None, "next": None, "updatedAt": now_iso()})
    write_json_atomic(os.path.join(DATA_DIR, "sports_bears.json"), {"live": None, "next": None, "updatedAt": now_iso()})
    write_json_atomic(os.path.join(DATA_DIR, "now_playing.json"), {"playing": False, "updatedAt": now_iso()})

    print("Updated:", now_iso())

if __name__ == "__main__":
    main()
