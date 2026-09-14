#!/usr/bin/env python3

import argparse
import io
import json
import re
import zipfile
from collections import Counter
from pathlib import Path


def clean(value):
    if value is None:
        return ""
    return str(value).strip()


def department_from_postcode(value):
    postcode = clean(value)
    if not re.fullmatch(r"\d{5}", postcode):
        return ""
    overseas = postcode[:3]
    if overseas in {"971", "972", "973", "974", "976"}:
        return overseas
    if postcode.startswith("20"):
        return ""
    return postcode[:2]


def has_record_id(feature, properties):
    if clean(feature.get("id")):
        return True
    if clean(properties.get("@spider")) and clean(properties.get("ref")):
        return True
    return bool(clean(properties.get("@source_uri")))


def has_coordinates(feature):
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates")
    if geometry.get("type") != "Point" or not isinstance(coordinates, list) or len(coordinates) < 2:
        return False
    try:
        longitude = float(coordinates[0])
        latitude = float(coordinates[1])
    except (TypeError, ValueError):
        return False
    return -180 <= longitude <= 180 and -90 <= latitude <= 90


class FeatureCollectionWriter:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("w", encoding="utf-8")
        self.handle.write('{"type":"FeatureCollection","features":[')
        self.first = True
        self.count = 0

    def write(self, feature):
        if not self.first:
            self.handle.write(",")
        json.dump(feature, self.handle, ensure_ascii=False, separators=(",", ":"))
        self.first = False
        self.count += 1

    def close(self):
        self.handle.write("]}")
        self.handle.close()


def empty_department_stats():
    return {
        "features": 0,
        "withAnyContact": 0,
        "withTelephone": 0,
        "withEmail": 0,
        "withWebsite": 0,
        "withName": 0,
        "withCoordinates": 0,
        "withSiret": 0,
        "withRecordId": 0,
        "generatorEligible": 0,
        "spiders": Counter(),
    }


def serialize_department_stats(stats):
    result = dict(stats)
    spiders = result.pop("spiders")
    result["spiderCount"] = len(spiders)
    result["topSpiders"] = [
        {"spider": spider, "features": count}
        for spider, count in spiders.most_common(15)
        if spider
    ]
    features = result["features"]
    result["contactRate"] = (result["withAnyContact"] / features) if features else 0
    result["telephoneRate"] = (result["withTelephone"] / features) if features else 0
    result["emailRate"] = (result["withEmail"] / features) if features else 0
    result["websiteRate"] = (result["withWebsite"] / features) if features else 0
    return result


def scan_zip(zip_path, departments, selected_dir):
    requested = set(departments)
    writers = {
        department: FeatureCollectionWriter(Path(selected_dir) / f"{department}.geojson")
        for department in departments
    }
    per_department = {department: empty_department_stats() for department in departments}
    global_stats = {
        "archiveEntries": 0,
        "geojsonFiles": 0,
        "invalidGeojsonFiles": 0,
        "featuresScanned": 0,
        "targetFeatures": 0,
    }
    errors = []

    try:
        with zipfile.ZipFile(zip_path) as archive:
            entries = sorted(
                (entry for entry in archive.infolist() if not entry.is_dir()),
                key=lambda entry: entry.filename,
            )
            global_stats["archiveEntries"] = len(entries)
            for entry in entries:
                if not entry.filename.lower().endswith(".geojson"):
                    continue
                global_stats["geojsonFiles"] += 1
                try:
                    with archive.open(entry, "r") as raw:
                        with io.TextIOWrapper(raw, encoding="utf-8") as text:
                            data = json.load(text)
                except Exception as error:
                    global_stats["invalidGeojsonFiles"] += 1
                    if len(errors) < 20:
                        errors.append({"file": entry.filename, "error": str(error)})
                    continue

                features = data.get("features") if isinstance(data, dict) else None
                if data.get("type") != "FeatureCollection" or not isinstance(features, list):
                    global_stats["invalidGeojsonFiles"] += 1
                    if len(errors) < 20:
                        errors.append({"file": entry.filename, "error": "Not a GeoJSON FeatureCollection"})
                    continue

                global_stats["featuresScanned"] += len(features)
                for feature in features:
                    if not isinstance(feature, dict):
                        continue
                    properties = feature.get("properties")
                    if not isinstance(properties, dict):
                        properties = {}
                    country = clean(properties.get("addr:country")).upper()
                    if country and country != "FR":
                        continue
                    department = department_from_postcode(properties.get("addr:postcode"))
                    if department not in requested:
                        continue

                    stats = per_department[department]
                    stats["features"] += 1
                    global_stats["targetFeatures"] += 1

                    telephone = clean(properties.get("phone"))
                    email = clean(properties.get("email"))
                    website = clean(properties.get("website"))
                    any_contact = bool(telephone or email or website)
                    record_id = has_record_id(feature, properties)

                    if telephone:
                        stats["withTelephone"] += 1
                    if email:
                        stats["withEmail"] += 1
                    if website:
                        stats["withWebsite"] += 1
                    if any_contact:
                        stats["withAnyContact"] += 1
                    if clean(properties.get("name")):
                        stats["withName"] += 1
                    if has_coordinates(feature):
                        stats["withCoordinates"] += 1
                    if clean(properties.get("ref:FR:SIRET") or properties.get("siret")):
                        stats["withSiret"] += 1
                    if record_id:
                        stats["withRecordId"] += 1
                    if any_contact and record_id:
                        stats["generatorEligible"] += 1
                        writers[department].write(feature)
                        spider = clean(properties.get("@spider"))
                        if spider:
                            stats["spiders"][spider] += 1
    finally:
        for writer in writers.values():
            writer.close()

    return {
        "schemaVersion": 1,
        "departments": departments,
        "global": global_stats,
        "perDepartment": {
            department: serialize_department_stats(per_department[department])
            for department in departments
        },
        "selectedFeatures": {
            department: writers[department].count
            for department in departments
        },
        "errors": errors,
    }


def main():
    parser = argparse.ArgumentParser(description="Measure All The Places contact coverage for French departments.")
    parser.add_argument("--zip", required=True, dest="zip_path", help="ATP output.zip archive")
    parser.add_argument("--departments", default="44,85", help="Comma-separated department codes")
    parser.add_argument("--selected-dir", required=True, help="Directory receiving reduced GeoJSON files")
    parser.add_argument("--report", required=True, help="JSON report path")
    args = parser.parse_args()

    departments = [value.strip().upper() for value in args.departments.split(",") if value.strip()]
    if not departments:
        raise SystemExit("At least one department is required")

    report = scan_zip(args.zip_path, departments, args.selected_dir)
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
