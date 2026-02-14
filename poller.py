#!/usr/bin/env python3

import os
import json
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

CTA_TRAIN_KEY = os.environ.get("CTA_TRAIN_KEY", "")
CTA_BUS_KEY   = os.environ.get("CTA_BUS_KEY", "")

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
TRANSIT_INTERVAL = 20   # seconds
SPORTS_INTERVAL  = 120  # seconds


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


# ===== Poll loops =====

def poll_transit():
    train = fetch_cta_trains("40360")
    write_json_atomic(os.path.join(DATA_DIR, "train.json"), train)

    bus_e = fetch_cta_bus_predictions("17833", rt="77", top="6")
    write_json_atomic(os.path.join(DATA_DIR, "bus_east.json"), bus_e)

    bus_w = fetch_cta_bus_predictions("14920", rt="77", top="6")
    write_json_atomic(os.path.join(DATA_DIR, "bus_west.json"), bus_w)

    write_json_atomic(os.path.join(DATA_DIR, "now_playing.json"), {"playing": False, "updatedAt": now_iso()})


def poll_sports():
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

    last_sports = 0

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

        print("Updated:", now_iso())
        time.sleep(TRANSIT_INTERVAL)


if __name__ == "__main__":
    main()
