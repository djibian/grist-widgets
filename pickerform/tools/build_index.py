#!/usr/bin/env python3

from pathlib import Path
import json

import polars as pl
from unidecode import unidecode

from config import *


# ------------------------------------------------------------
# Colonnes conservées
# ------------------------------------------------------------

COLUMNS = [
    "siret",
    "siren",
    "nic",
    "denominationUniteLegale",
    "enseigne1Etablissement",
    "numeroVoieEtablissement",
    "typeVoieEtablissement",
    "libelleVoieEtablissement",
    "codePostalEtablissement",
    "libelleCommuneEtablissement",
    "activitePrincipaleEtablissement",
    "etatAdministratifEtablissement",
]


# ------------------------------------------------------------
# Normalisation
# ------------------------------------------------------------

def normalize(text):

    if text is None:
        return ""

    text = str(text)

    text = unidecode(text)

    text = text.lower()

    text = " ".join(text.split())

    return text


# ------------------------------------------------------------
# Construction de l'adresse
# ------------------------------------------------------------

def build_address(row):

    parts = [
        row["numeroVoieEtablissement"],
        row["typeVoieEtablissement"],
        row["libelleVoieEtablissement"],
    ]

    return " ".join(
        str(x)
        for x in parts
        if x is not None and str(x).strip() != ""
    )


# ------------------------------------------------------------
# Lecture du fichier
# ------------------------------------------------------------

print("Lecture du fichier SIRENE...")

df = pl.read_csv(
    INPUT_FILE,
    separator=",",
    infer_schema_length=10000,
    ignore_errors=True,
)

print(f"{df.height:,} lignes")
print()


# ------------------------------------------------------------
# Filtrage
# ------------------------------------------------------------

print("Filtrage des départements...")

df = df.filter(
    pl.col("codePostalEtablissement")
    .cast(pl.Utf8)
    .str.starts_with(tuple(DEPARTEMENTS))
)

print(f"{df.height:,} lignes conservées")
print()


# ------------------------------------------------------------
# État administratif
# ------------------------------------------------------------

df = df.filter(
    pl.col("etatAdministratifEtablissement") == "A"
)


# ------------------------------------------------------------
# Colonnes utiles
# ------------------------------------------------------------

df = df.select(COLUMNS)


# ------------------------------------------------------------
# Export JSON
# ------------------------------------------------------------

print("Construction du JSON...")

entreprises = []

for row in df.iter_rows(named=True):

    nom = (
        row["enseigne1Etablissement"]
        or row["denominationUniteLegale"]
        or ""
    )

    adresse = build_address(row)

    commune = row["libelleCommuneEtablissement"] or ""

    entreprises.append({

        "id": len(entreprises),

        "siret": row["siret"],

        "siren": row["siren"],

        "nom": nom,

        "adresse": adresse,

        "code_postal": row["codePostalEtablissement"],

        "commune": commune,

        "ape": row["activitePrincipaleEtablissement"],

        "search": normalize(
            f"{nom} {adresse} {commune}"
        ),

    })


print("Écriture du JSON...")

with open(OUTPUT_JSON, "w", encoding="utf8") as f:

    json.dump(
        entreprises,
        f,
        ensure_ascii=False,
        indent=2,
    )

print()
print(f"{len(entreprises):,} entreprises exportées.")
print(f"Fichier : {OUTPUT_JSON}")
