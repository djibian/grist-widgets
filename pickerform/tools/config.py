from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

DATA_DIR = BASE_DIR / "widget" / "data"
DATA_DIR.mkdir(exist_ok=True)

DOWNLOAD_DIR = BASE_DIR / "downloads"
DOWNLOAD_DIR.mkdir(exist_ok=True)

DEPARTEMENTS = ["44", "85"]

OUTPUT_JSON = DATA_DIR / "entreprises.json"
