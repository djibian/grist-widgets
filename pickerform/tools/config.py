from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent

TOOLS_DIR = ROOT_DIR / "tools"

WIDGET_DIR = ROOT_DIR / "widget"

DATA_DIR = WIDGET_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DOWNLOAD_DIR = ROOT_DIR / "downloads"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

PARQUET_FILE = DOWNLOAD_DIR / "StockEtablissement.parquet"

ENTREPRISES_JSON = DATA_DIR / "entreprises.json"

DATASET_ID = "5c4ae55a634f4137716d5656"

DEPARTEMENTS = ("44", "85")
