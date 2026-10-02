#!/usr/bin/env python3
"""Publish point POIs carrying geographic FINESS references, without spatial joins."""
import argparse
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request

ENDPOINT = "https://overpass-api.de/api/interpreter"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "widgets/structure-picker/site-position-indexes/osm-finess"
MAX_SHARD_BYTES = 96 * 1024


def build_shards(document, query, endpoint):
    generated_at = document.get("osm3s", {}).get("timestamp_osm_base")
    if document.get("remark") or not generated_at or not isinstance(document.get("elements"), list):
        raise ValueError("Incomplete OSM source; no positions published")
    shards = {}
    seen = set()
    for element in document["elements"]:
        tags = element.get("tags", {})
        if element.get("type") != "node" or not element.get("timestamp") or not element.get("version"):
            continue
        if tags.get("highway") or tags.get("place") or any(re.match(r"^(disused|abandoned|demolished):", key) for key in tags):
            continue
        if not any(tags.get(key) for key in ("amenity", "healthcare", "social_facility", "shop", "building")):
            continue
        ids = [value.strip().upper() for value in re.split(r"[;,]", tags.get("ref:FR:FINESS", ""))]
        if not ids or any(not re.fullmatch(r"[A-Z0-9]{9}", value) for value in ids):
            continue
        if not isinstance(element.get("lat"), (int, float)) or not isinstance(element.get("lon"), (int, float)):
            continue
        if not -90 <= element["lat"] <= 90 or not -180 <= element["lon"] <= 180:
            continue
        if element["id"] in seen:
            raise ValueError("Duplicate OSM object")
        seen.add(element["id"])
        record = {key: element[key] for key in ("type", "id", "lat", "lon", "timestamp", "version", "changeset", "tags") if key in element}
        for prefix in set(value[:6] for value in ids):
            shards.setdefault(prefix, []).append(record)
    if not shards:
        raise ValueError("No typed point POIs with geographic FINESS")
    source = {"id": "osm-finess-positions", "label": "OpenStreetMap — identifiants FINESS",
              "url": endpoint + "?" + urllib.parse.urlencode({"data": query}), "query": query,
              "generatedAt": generated_at, "generator": document.get("generator"), "license": "ODbL 1.0"}
    return {prefix: {"schemaVersion": 1, "prefix": prefix, "source": source,
                     "recordCount": len(records), "records": sorted(records, key=lambda item: item["id"])}
            for prefix, records in shards.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Complete raw Overpass JSON; omitted to fetch current data")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--departments", default="44,85")
    parser.add_argument("--endpoint", default=ENDPOINT)
    args = parser.parse_args()
    departments = args.departments.split(",")
    if not all(re.fullmatch(r"(?:\d{2,3}|2[AB])", value) for value in departments):
        raise ValueError("Invalid FINESS departmental prefixes")
    query = '[out:json][timeout:60];nwr["ref:FR:FINESS"~"^(' + "|".join(departments) + ')"];out meta center;'
    if args.input:
        document = json.loads(args.input.read_text())
    else:
        request = urllib.request.Request(args.endpoint, data=urllib.parse.urlencode({"data": query}).encode(),
                                         headers={"Accept": "application/json", "User-Agent": "grist-widgets-source-index"})
        with urllib.request.urlopen(request, timeout=65) as response:
            document = json.load(response)
    shards = build_shards(document, query, args.endpoint)
    encoded = {prefix: json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n" for prefix, payload in shards.items()}
    if any(len(text.encode()) > MAX_SHARD_BYTES for text in encoded.values()):
        raise ValueError("OSM shard exceeds the browser payload budget")
    args.output.mkdir(parents=True, exist_ok=True)
    for old in args.output.glob("*.json"):
        if old.stem not in shards:
            old.unlink()
    for prefix, text in encoded.items():
        (args.output / f"{prefix}.json").write_text(text)
    print(f"OSM FINESS: {sum(len(payload['records']) for payload in shards.values())} point records in {len(shards)} shards; {document['osm3s']['timestamp_osm_base']}")


if __name__ == "__main__":
    main()
