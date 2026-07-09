# Grist Stage Search

Widget Grist permettant de rechercher rapidement une structure de stage (entreprise, association, administration...) à partir des données officielles SIRENE.

Le widget fonctionne entièrement côté navigateur.

Aucun serveur n'est nécessaire.

## Architecture

```
pickerform/

├── widget/
│   ├── index.html
│   ├── app.js
│   ├── grist.js
│   ├── search.js
│   ├── result.js
│   ├── style.css
│   ├── lib/
│   │   └── minisearch.min.js
│   └── data/
│       └── entreprises.json
│
├── tools/
│   ├── build_json.py
│   ├── build_index.py
│   ├── config.py
│   ├── requirements.txt
│   └── sirene/
│       ├── __init__.py
│       ├── download.py
│       └── transform.py
│
├── downloads/
│   └── StockEtablissement.parquet
│
└── README.md
```

## Dépendances Python

Installation :

```bash
cd tools

python3 -m pip install -r requirements.txt
```

## Mise à jour mensuelle

Téléchargement du dernier stock SIRENE :

```bash
python3 test_download.py
```

Construction des données du widget :

```bash
python3 build_json.py
```

Plus tard :

```bash
python3 build_index.py
```

## Technologies

- Python
- Polars
- MiniSearch
- JavaScript
- API officielle Grist

## Philosophie

- aucun serveur
- aucune base SQL
- aucune dépendance Node.js
- aucune dépendance Docker
- fonctionnement entièrement local dans le navigateur

Les données SIRENE sont téléchargées périodiquement puis transformées en JSON optimisé pour le widget.
