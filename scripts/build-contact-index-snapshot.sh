#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config="${CONTACT_INDEX_CONFIG:-$repo_root/widgets/structure-picker/contact-indexes/publication-config.json}"
output_root="${1:-/tmp/contact-index-publication/widgets/structure-picker/contact-indexes}"

if [[ ! -f "$config" ]]; then
  echo "Publication config not found: $config" >&2
  exit 1
fi

schema_version="$(jq -r '.schemaVersion' "$config")"
departments="$(jq -r '.departments | join(",")' "$config")"
bbox="$(jq -r '.overtureBBox | map(tostring) | join(",")' "$config")"

[[ "$schema_version" == "1" ]] || { echo "Unsupported publication config schema: $schema_version" >&2; exit 1; }
[[ -n "$departments" ]] || { echo "No publication departments configured" >&2; exit 1; }
[[ -n "$bbox" ]] || { echo "No Overture bounding box configured" >&2; exit 1; }
command -v overturemaps >/dev/null || { echo "overturemaps CLI is required" >&2; exit 1; }

generated_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

rm -rf "$output_root"
mkdir -p "$output_root/all-the-places" "$output_root/overture"
cp "$repo_root/widgets/structure-picker/contact-indexes/indexed-departments.json" "$output_root/indexed-departments.json"
cp "$config" "$output_root/publication-config.json"

echo "Resolving All The Places latest run..."
curl --fail --location --retry 4 --retry-delay 5 \
  --output "$work_dir/atp-latest.json" \
  https://data.alltheplaces.xyz/runs/latest.json
atp_run_id="$(jq -r '.run_id' "$work_dir/atp-latest.json")"
atp_output_url="$(jq -r '.output_url' "$work_dir/atp-latest.json")"
[[ -n "$atp_run_id" && "$atp_run_id" != "null" ]] || { echo "Invalid ATP run id" >&2; exit 1; }
[[ -n "$atp_output_url" && "$atp_output_url" != "null" ]] || { echo "Invalid ATP output URL" >&2; exit 1; }

echo "Downloading All The Places run $atp_run_id..."
curl --fail --location --retry 4 --retry-delay 5 \
  --output "$work_dir/atp-output.zip" \
  "$atp_output_url"
mkdir -p "$work_dir/atp-selected"
python3 "$repo_root/scripts/measure-all-the-places-coverage.py" \
  --zip "$work_dir/atp-output.zip" \
  --departments "$departments" \
  --selected-dir "$work_dir/atp-selected" \
  --report "$work_dir/atp-scan-report.json" \
  > "$work_dir/atp-scan-output.json"
node "$repo_root/scripts/generate-all-the-places-index.mjs" \
  --input "$work_dir/atp-selected" \
  --departments "$departments" \
  --output "$output_root/all-the-places" \
  --manifest "$output_root/indexed-departments.json" \
  --run-id "$atp_run_id" \
  --generated-at "$generated_at" \
  > "$work_dir/atp-generator-report.json"

echo "Resolving Overture release..."
curl --fail --location --retry 4 --retry-delay 5 \
  https://stac.overturemaps.org/catalog.json \
  -o "$work_dir/overture-catalog.json"
overture_release="$(jq -r '.latest' "$work_dir/overture-catalog.json")"
[[ -n "$overture_release" && "$overture_release" != "null" ]] || { echo "Invalid Overture release" >&2; exit 1; }

echo "Downloading Overture Places release $overture_release..."
overturemaps download \
  --bbox="$bbox" \
  -f geojsonseq \
  --type=place \
  -o "$work_dir/overture-places.geojsonseq"
node "$repo_root/scripts/generate-overture-index.mjs" \
  --input "$work_dir/overture-places.geojsonseq" \
  --departments "$departments" \
  --output "$output_root/overture" \
  --manifest "$output_root/indexed-departments.json" \
  --release "$overture_release" \
  --generated-at "$generated_at" \
  > "$work_dir/overture-generator-report.json"

CONTACT_INDEX_ROOT="$output_root" CONTACT_INDEX_DEPARTMENTS="$departments" python3 - <<'PY'
import json
import os
from pathlib import Path

root = Path(os.environ['CONTACT_INDEX_ROOT'])
departments = [value for value in os.environ['CONTACT_INDEX_DEPARTMENTS'].split(',') if value]
manifest = json.loads((root / 'indexed-departments.json').read_text())
if manifest.get('schemaVersion') != 1:
    raise SystemExit('Unexpected manifest schema version')

for source in ('all-the-places', 'overture'):
    published = manifest.get('sources', {}).get(source, {}).get('departments', [])
    if published != departments:
        raise SystemExit(f'{source}: manifest departments {published!r} != {departments!r}')
    for department in departments:
        path = root / source / f'{department}.json'
        if not path.is_file():
            raise SystemExit(f'Missing {path}')
        data = json.loads(path.read_text())
        if data.get('schemaVersion') != 1 or data.get('source') != source or data.get('department') != department:
            raise SystemExit(f'Invalid metadata in {path}')
        if data.get('recordCount', 0) <= 0 or data.get('recordCount') != len(data.get('records', [])):
            raise SystemExit(f'Invalid record count in {path}')
        print(f"{source} {department}: {data['recordCount']} records; {path.stat().st_size / 1024 / 1024:.2f} MiB")
PY

echo "Snapshot generated at $generated_at"
echo "ATP run: $atp_run_id"
echo "Overture release: $overture_release"
du -sh "$output_root"
