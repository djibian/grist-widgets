from config import PARQUET_FILE

import polars as pl


print("Ouverture du fichier...")

lazy = pl.scan_parquet(PARQUET_FILE)

print("Filtrage des départements...")

df = (
    lazy
    .filter(
        pl.col("codePostalEtablissement")
        .cast(pl.Utf8)
        .str.starts_with(("44", "85"))
    )
    .collect()
)

print()

print(f"Nombre d'établissements : {len(df):,}")

print()

print(df.head())
