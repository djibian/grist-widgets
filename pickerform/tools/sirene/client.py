from pathlib import Path
import requests

from config import DOWNLOAD_DIR

API_URL = "https://www.data.gouv.fr/api/1/datasets/"


def find_dataset():
    """
    Recherche le dataset officiel SIRENE.
    """

    print("Recherche du dataset SIRENE...")

    r = requests.get(
        API_URL,
        params={
            "q": "Base SIRENE StockEtablissement parquet",
            "page_size": 5,
        },
        timeout=60,
    )

    r.raise_for_status()

    datasets = r.json()["data"]

    if not datasets:
        print("Réponse API :")
        print(response.json())
        raise RuntimeError("Dataset SIRENE introuvable.")

    return datasets[0]


def find_parquet_resource(dataset):
    """
    Recherche la ressource Parquet StockEtablissement.
    """

    print("Recherche du fichier Parquet...")

    for resource in dataset["resources"]:

        title = (resource.get("title") or "").lower()
        fmt = (resource.get("format") or "").lower()
        url = resource.get("url") or ""

        if (
            "stocketablissement" in title
            and (
                fmt == "parquet"
                or url.lower().endswith(".parquet")
            )
        ):
            return resource

    raise RuntimeError("Aucun fichier Parquet trouvé.")


def download_latest_dataset():

    dataset = find_dataset()

    resource = find_parquet_resource(dataset)

    url = resource["url"]

    filename = Path(url).name

    destination = DOWNLOAD_DIR / filename

    print()
    print(f"Téléchargement : {filename}")

    with requests.get(url, stream=True, timeout=300) as r:

        r.raise_for_status()

        with open(destination, "wb") as f:

            for chunk in r.iter_content(1024 * 1024):

                if chunk:
                    f.write(chunk)

    print("Téléchargement terminé.")
    print(destination)

    return destination
