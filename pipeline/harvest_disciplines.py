"""Discover the long discipline names each event group's results actually carry.

Table 2.12 lists similar events in short form ("1500m sh"); the World Athletics
result feeds use long form ("1500 Metres Short Track"). Matching results to an
event group needs the long names, and they are not published as a mapping — so
read them off real ranking calculations, which is where they are authoritative.

For each event group this samples the top N ranked athletes, fetches each one's
ranking calculation, and unions the `disciplineList` plus every result's own
`discipline`. Athletes ranked near the top have full counting sets, so a small
sample surfaces the similar events quickly; rare ones need a deeper sample,
which is what --sample is for.

Run after scrape_rules.py. Network-bound and slow by design (it is rate limited);
this is a one-off run when World Athletics changes the event group definitions.
"""
import argparse
import json
import time
import urllib.request
from pathlib import Path
from urllib.parse import quote

EA_TRPC = "https://api.european-athletics.com/trpc"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
DATA = Path(__file__).resolve().parent.parent / "src" / "data"
GROUPS = DATA / "event_groups.json"

# Politeness delay between calls. The gateway is undocumented and Cloudflare
# fronted; hammering it is both rude and a good way to get blocked.
DELAY_S = 0.35


def trpc(proc: str, payload: dict) -> dict:
    # stdlib urllib, not requests: the gateway's Cloudflare front 403s the
    # requests/urllib3 TLS fingerprint even with a browser User-Agent, while the
    # same headers over urllib are served. Verified 2026-07-27.
    url = f"{EA_TRPC}/{proc}?input={quote(json.dumps({'json': payload}))}"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    if "error" in body:
        raise RuntimeError(f"{proc}: {body['error']}")
    return body["result"]["data"]["json"]


def disciplines_for(slug: str, gender: str, sample: int) -> set[str]:
    found: set[str] = set()
    ranking = trpc("worldAthletics.getRanking", {"eventGroup": slug, "gender": gender})
    time.sleep(DELAY_S)
    for row in ranking.get("rankings", [])[:sample]:
        calc_id = row.get("id")
        if calc_id is None:
            continue
        try:
            calc = trpc("worldAthletics.getRankingScoreCalculation", {"calculationId": calc_id})
        except Exception as exc:  # one athlete failing must not lose the whole group
            print(f"    ! calculation {calc_id} failed: {exc}")
            time.sleep(DELAY_S)
            continue
        for name in calc.get("disciplineList") or []:
            found.add(str(name).strip())
        for result in calc.get("results") or []:
            name = str(result.get("discipline", "")).strip()
            if name:
                found.add(name)
        time.sleep(DELAY_S)
    return found


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, default=25,
                        help="ranked athletes to sample per event group")
    args = parser.parse_args()

    payload = json.loads(GROUPS.read_text(encoding="utf-8"))
    for group in payload["groups"]:
        slug, gender, label = group.get("slug"), group["gender"], group["label"]
        if not slug:
            raise ValueError(f"{label}: no ranking API slug; fix SLUG_BY_MAIN_EVENT first")
        print(f"  {label} ({slug}/{gender}) …")
        names = disciplines_for(slug, gender, args.sample)
        if not names:
            raise ValueError(f"{label}: no disciplines found; the sample or the slug is wrong")
        group["disciplines"] = sorted(names)
        print(f"    {len(names)}: {sorted(names)}")

    GROUPS.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    total = sum(len(g["disciplines"]) for g in payload["groups"])
    print(f"Wrote {GROUPS}: {len(payload['groups'])} groups, {total} discipline names")


if __name__ == "__main__":
    main()
