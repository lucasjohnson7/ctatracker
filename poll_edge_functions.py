import json
import time
import requests
from datetime import datetime
from pathlib import Path

BASE_URL = "https://ctatracker-zszc.vercel.app"
OUT_DIR = Path("kiosk/data")
POLL_SECONDS = 20

ENDPOINTS = {
    "southport.json": "/api/train?mapid=40360",
    "77_east.json": "/api/bus?stpid=17833&rt=77",
    "77_west.json": "/api/bus?stpid=14920&rt=77",
    "sports.json": "/api/sports?team=bears",
    "sonos.json": "/api/sonos/now-playing",
}

def fetch_and_write(filename, path):
    url = BASE_URL + path
    r = requests.get(url, timeout=10)
    r.raise_for_status()

    tmp = OUT_DIR / (filename + ".tmp")
    final = OUT_DIR / filename

    with open(tmp, "w") as f:
        json.dump(r.json(), f, indent=2)

    tmp.replace(final)
    print(f"Wrote {filename}")

def poll_southport():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    try:
        fetch_and_write("southport.json", ENDPOINTS["southport.json"])
    except Exception as e:
        print(f"Failed southport.json: {e}")

def poll_77_bus():
    """Fetch both 77 directions, transform rows to southport format, and write combined JSON to `77.json`."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    combined = []
    for filename in ["77_east.json", "77_west.json"]:
        try:
            url = BASE_URL + ENDPOINTS[filename]
            r = requests.get(url, timeout=10)
            r.raise_for_status()
            data = r.json()
            rows = data.get("rows", [])
            for rrow in rows:
                prdtm = rrow.get("prdtm")
                arrT = None
                if prdtm:
                    try:
                        date_part, time_part = prdtm.split(" ")
                        arrT = f"{date_part[0:4]}-{date_part[4:6]}-{date_part[6:8]}T{time_part}:00"
                    except Exception:
                        arrT = None

                prdctdn = rrow.get("prdctdn")
                is_app = False
                try:
                    is_app = int(prdctdn) == 0
                except Exception:
                    is_app = False

                entry = {
                    "staId": rrow.get("stpid", ""),
                    "stpId": rrow.get("stpid", ""),
                    "stpDe": f"Service toward {rrow.get('des', '')}",
                    "staNm": rrow.get("stpnm", ""),
                    "rn": str(rrow.get("vid") or rrow.get("tatripid") or ""),
                    "destNm": rrow.get("des", ""),
                    "arrT": arrT,
                    "isApp": is_app,
                    "isDly": bool(rrow.get("dly", False)),
                }
                combined.append(entry)
        except Exception as e:
            print(f"Failed fetch {filename}: {e}")

    # sort by arrival time (ISO string), with missing times last
    combined.sort(key=lambda e: (e.get("arrT") is None, e.get("arrT")))

    tmp = OUT_DIR / ("77.json.tmp")
    final = OUT_DIR / ("77.json")

    with open(tmp, "w") as f:
        json.dump(combined, f, indent=2)

    tmp.replace(final)
    print("Wrote 77.json")


def poll_sports():
    """Placeholder for sports polling (not implemented yet)."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    
    try:
        fetch_and_write("sports.json", ENDPOINTS["sports.json"])
    except Exception as e:
        print(f"Failed sports.json: {e}")


def poll_sonos():
    """Placeholder for sonos polling (not implemented yet)."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    
    try:
        fetch_and_write("sonos.json", ENDPOINTS["sonos.json"])
    except Exception as e:
        print(f"Failed sonos.json: {e}")

def wxIconFile(code):
    now = datetime.now()
    isDay = (now.hour >= 6 and now.hour <= 18)

    icon_path = None
    icon_text = ''

    # Clear weather
    if code == 0 and isDay:
        if isDay:
            icon_path = './images/sun.png'
        else:
            icon_path = './images/moon.png'
        icon_text = 'Clear'
    
    # Partly cloudy
    if code in [1,2]:
        icon_path = './images/partlycloudy.png'
        icon_text = 'Mostly Clear'
    
    if code == 3:
        icon_text = 'Partly cloudy'
    
    # Cloudy
    if code in [45, 48]:
        icon_path = './images/cloudy.png'
        icon_text = 'Foggy'
    
    # Rain
    if code in [51,53,55,56,57]:
        icon_path = './images/rain.png'
        icon_text = 'Drizzle'

    if code in [61,63,65,66,67]:
        icon_path = './images/rain.png'
        icon_text = 'Rain'
    
    if code in [80,81,82]:
        icon_path = './images/rain.png'
        icon_text = 'Showers'
    
    # Snow
    if code in [71,73,75,77]:
        icon_path = './images/snow.png'
        icon_text = 'Snow'

    if code in [85,86]:
        icon_path = './images/snow.png'
        icon_text = 'Snow Showers'

    if code in [95,96,99]:
        icon_path = './images/rain.png'
        icon_text = 'Thunderstorms'
    
    #Fallback
    icon_path = './images/cloudy.png'
    icon_text = 'Cloudy'

    return icon_path, icon_text

def poll_weather():
    """Fetch weather data and write to weather.json."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    wx_lat = 41.94
    wx_lon = -87.66
    wx_url = f"https://api.open-meteo.com/v1/forecast?latitude={wx_lat}&longitude={wx_lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit"

    try:
        response = requests.get(wx_url)
        data = response.json()
        current_state = data.get('current')
        temperature = current_state['temperature_2m']
        weather_code = current_state['weather_code']
    except Exception as e:
        print(f"Failed weather.json: {e}")

    icon_path, icon_text = wxIconFile(weather_code)
    
    weather_data = {
        "temperature": temperature,
        "weather_code": weather_code,
        "icon_path": icon_path,
        "icon_text": icon_text
    }

    tmp = OUT_DIR / ("weather.json.tmp")
    final = OUT_DIR / ("weather.json")
    with open(tmp, "w") as f:
        json.dump(weather_data, f, indent=2)
    tmp.replace(final)
    print("Wrote weather.json")

def poll_once():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    try:
        poll_southport()
    except Exception as e:
        print(f"poll_southport failed: {e}")

    try:
        poll_77_bus()
    except Exception as e:
        print(f"poll_77_bus failed: {e}")

    try:
        poll_sports()
    except Exception as e:
        print(f"poll_sports failed: {e}")

    try:
        poll_sonos()
    except Exception as e:
        print(f"poll_sonos failed: {e}")

    try:
        poll_weather()
    except Exception as e:
        print(f"poll_weather failed: {e}")

if __name__ == "__main__":
    while True:
        poll_once()
        time.sleep(POLL_SECONDS)
