from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

DOWNLOAD_DIR = BASE_DIR / "downloads"
DOWNLOAD_DIR.mkdir(exist_ok=True)

DATA_DIR = BASE_DIR / "widget" / "data"
DATA_DIR.mkdir(exist_ok=True)

DATASET_ID = "5c4ae55a634f4137716d5656"

PARQUET_FILE = DOWNLOAD_DIR / "StockEtablissement.parquet"
