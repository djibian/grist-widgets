#!/usr/bin/env python3
"""Build geographic identity shards from the official FINESS Structures JSON."""
import argparse
import gzip
import json
from pathlib import Path
import tempfile
import urllib.request

SOURCE_URL = "https://www.data.gouv.fr/api/1/datasets/r/cd493959-fb03-41e5-9347-0edd14dfbc22"
DATASET_URL = "https://www.data.gouv.fr/datasets/finess-structures-1"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "widgets/structure-picker/identity-links/finess"


def build_shards(document, departments, source_url):
    if document.get("schemaVersion") != "v1.0.0" or not document.get("generatedAt") or not isinstance(document.get("pmej"), list):
        raise ValueError("Unsupported FINESS Structures schema")
    shards = {}
    seen = set()
    for legal_entity in document["pmej"]:
        # Only EGE carries a geographic identity/SIRET. Never inherit PMEJ data.
        for site in legal_entity.get("ege", []):
            info = site.get("informationsGeneralesEGE", {})
            addresses = [address for address in site.get("adresse", []) if address.get("usageAdresse") == "03"]
            eligible_addresses = []
            for address in addresses:
                commune = str(address.get("cogCommune") or "")
                department = commune[:3] if commune.startswith(("97", "98")) else commune[:2]
                if department in departments:
                    eligible_addresses.append(address)
            if not eligible_addresses:
                continue
            finess = str(info.get("numFinessEge") or "").upper()
            siret = str(info.get("siret") or "")
            if len(finess) != 9 or not finess.isalnum() or len(siret) != 14 or not siret.isdigit():
                continue
            if site.get("etatObjet") != "A" or info.get("dateFermeture"):
                continue
            if finess in seen:
                raise ValueError(f"Duplicate geographic FINESS: {finess}")
            seen.add(finess)
            compact = {
                "informationsGeneralesEGE": {key: info.get(key) for key in (
                    "egeId", "numFinessEge", "siret", "nomEgeCourt", "nomEgeLong", "dateFermeture")},
                "adresse": eligible_addresses,
                "categorieentiteGeographiqueExercice": site.get("categorieentiteGeographiqueExercice"),
                "etatObjet": site["etatObjet"], "dateDerniereMaj": site.get("dateDerniereMaj"),
            }
            shards.setdefault(finess[:2], []).append(compact)
    if not shards:
        raise ValueError("No active geographic FINESS with SIRET in requested departments")
    source = {"id": "finess-ans", "label": "FINESS — Agence du Numérique en Santé",
              "url": source_url, "datasetUrl": DATASET_URL, "schemaVersion": document["schemaVersion"],
              "generatedAt": document["generatedAt"], "license": "Licence Ouverte 2.0"}
    return {prefix: {"schemaVersion": 1, "prefix": prefix, "recordCount": len(records), "departments": sorted(departments),
                     "source": source, "records": sorted(records, key=lambda site: site["informationsGeneralesEGE"]["numFinessEge"])}
            for prefix, records in shards.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Downloaded official JSON or JSON.gz; omitted to download the current daily flux")
    parser.add_argument("--source-url", default=SOURCE_URL, help="Provenance URL when using a local input")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--departments", default="44,85")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="finess-identity-") as temp:
        path = args.input
        source_url = args.source_url
        if path is None:
            path = Path(temp) / "structures.json.gz"
            with urllib.request.urlopen(SOURCE_URL, timeout=120) as response, path.open("wb") as output:
                source_url = response.url
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
        open_input = gzip.open if path.suffix == ".gz" else open
        with open_input(path, "rt", encoding="utf-8") as input_file:
            document = json.load(input_file)
        shards = build_shards(document, set(args.departments.split(",")), source_url)
        args.output.mkdir(parents=True, exist_ok=True)
        for old in args.output.glob("*.json"):
            if old.stem not in shards:
                old.unlink()
        for prefix, payload in shards.items():
            (args.output / f"{prefix}.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"FINESS: {sum(len(shard['records']) for shard in shards.values())} geographic identities in {len(shards)} shards; {document['generatedAt']}")


if __name__ == "__main__":
    main()
