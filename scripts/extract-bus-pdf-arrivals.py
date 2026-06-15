import json
import io
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = ROOT / "data" / "tyo-nrt-arrivals.json"
PDF_URL = "https://tyo-nrt.com/wp/wp-content/themes/tyo-nrt/files/timetable_new_horizon.pdf"


def normalize_time(value: str) -> str:
    hour, minute = map(int, value.split(":"))
    if hour < 4:
        hour += 24
    return f"{hour:02d}:{minute:02d}"


def tokens(value: str) -> list[str]:
    return re.findall(r"\d{1,2}:\d{2}|―", value)


def main() -> None:
    request = Request(PDF_URL, headers={"User-Agent": "Mozilla/5.0 departure-board-data-maintenance"})
    reader = PdfReader(io.BytesIO(urlopen(request).read()))
    text = reader.pages[1].extract_text() or ""
    pattern = re.compile(
        r"Terminal 2　Bus stop 6 (?P<departures>.*?)\n"
        r"成田空港第１ターミナル7番.*?\n"
        r"✈ Terminal 1　Bus stop 7 .*?\n"
        r"▼.*?\n"
        r"東京駅　日本橋口\n"
        r"Tokyo Sta\. Nihombashi Gate\. (?P<tokyo>.*?)\n"
        r"銀座駅\n"
        r"Ginza Sta\. (?P<ginza>.*?)\n"
        r"東雲イオン前",
        re.S,
    )

    arrivals: dict[str, list[dict[str, str]]] = {}
    for match in pattern.finditer(text):
        departures = tokens(match.group("departures"))
        tokyo = tokens(match.group("tokyo"))
        ginza = tokens(match.group("ginza"))
        if not (len(departures) == len(tokyo) == len(ginza)):
            raise SystemExit(
                f"Column count mismatch: departures={len(departures)} "
                f"tokyo={len(tokyo)} ginza={len(ginza)}"
            )
        for departure, tokyo_time, ginza_time in zip(departures, tokyo, ginza):
            reference_times = []
            if tokyo_time != "―":
                reference_times.append(
                    {
                        "stationName": "東京駅",
                        "arrivalTime": normalize_time(tokyo_time),
                        "timeType": "arrival",
                        "source": "manual",
                        "confidence": "manual",
                    }
                )
            if ginza_time != "―":
                reference_times.append(
                    {
                        "stationName": "銀座駅",
                        "arrivalTime": normalize_time(ginza_time),
                        "timeType": "arrival",
                        "source": "manual",
                        "confidence": "manual",
                    }
                )
            if reference_times:
                arrivals[normalize_time(departure)] = reference_times

    if not arrivals:
        raise SystemExit("No bus arrival times extracted")

    output = {
        "metadata": {
            "sourceUrl": PDF_URL,
            "effectiveFrom": "2026-04-01",
            "status": "manual",
        },
        "arrivalsByDepartureTime": arrivals,
    }
    serialized = json.dumps(output, ensure_ascii=False, indent=2) + "\n"
    if "--stdout" in sys.argv:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdout.write(serialized)
    else:
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_PATH.write_text(serialized, encoding="utf-8")
        print(f"{OUTPUT_PATH.name}: {len(arrivals)} departures")


if __name__ == "__main__":
    main()
