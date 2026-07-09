from pathlib import Path
import requests

from config import DATASET_ID, PARQUET_FILE


API_URL = f"https://www.data.gouv.fr/api/1/datasets/{DATASET_ID}/"


def get_dataset():

    print("Lecture des métadonnées...")

    r = requests.get(API_URL, timeout=60)
    r.raise_for_status()

    return r.json()


def find_parquet_resource(dataset):

    for resource in dataset["resources"]:

        url = resource.get("url", "")

        if url.lower().endswith(".parquet"):
            return resource

    raise RuntimeError("Aucun fichier parquet trouvé.")


def download_resource(resource):

    url = resource["url"]

    print("Téléchargement :")
    print(url)
    print()

    r = requests.get(url, stream=True, timeout=300)
    r.raise_for_status()

    total = 0

    with open(PARQUET_FILE, "wb") as f:

        for chunk in r.iter_content(1024 * 1024):

            if not chunk:
                continue

            f.write(chunk)
            total += len(chunk)

            print(
                f"\r{total/1024/1024:.1f} Mo",
                end="",
                flush=True,
            )

    print()
    print("Téléchargement terminé.")
    print(PARQUET_FILE)

    return PARQUET_FILE


def download_latest():

    dataset = get_dataset()

    resource = find_parquet_resource(dataset)

    return download_resource(resource)
