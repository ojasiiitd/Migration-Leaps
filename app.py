#!/usr/bin/env python3

from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path

from flask import Flask, jsonify, render_template


BASE_DIR = Path(__file__).resolve().parent
DATASET_PATH = BASE_DIR / "migration_table1_countries_clean.csv"

YEARS = ["1990", "1995", "2000", "2005", "2010", "2015", "2020", "2024"]
ORIGIN_COL = "Region, development group, country or area of origin"
DEST_COL = "Region, development group, country or area of destination"

CONTINENT_COUNTRIES = {
    "Africa": [
        "Nigeria",
        "Egypt",
        "South Africa",
        "Ethiopia",
        "Kenya",
        "Morocco",
        "Sudan",
        "South Sudan",
        "Democratic Republic of the Congo",
        "Côte d'Ivoire",
    ],
    "Asia": [
        "India",
        "China",
        "Pakistan",
        "Bangladesh",
        "Indonesia",
        "Japan",
        "Republic of Korea",
        "Saudi Arabia",
        "United Arab Emirates",
        "Philippines",
    ],
    "Europe": [
        "Germany",
        "United Kingdom*",
        "France*",
        "Spain*",
        "Italy",
        "Poland",
        "Romania",
        "Ukraine*",
        "Russian Federation",
        "Netherlands*",
    ],
    "North America": [
        "United States of America*",
        "Canada",
        "Mexico",
        "Cuba",
        "Dominican Republic",
        "Guatemala",
        "Haiti",
        "Jamaica",
        "El Salvador",
        "Costa Rica",
    ],
    "South America": [
        "Brazil",
        "Argentina",
        "Colombia",
        "Venezuela (Bolivarian Republic of)",
        "Peru",
        "Chile",
        "Ecuador",
        "Bolivia (Plurinational State of)",
        "Paraguay",
        "Uruguay",
    ],
    "Oceania": [
        "Australia*",
        "New Zealand*",
        "Papua New Guinea",
        "Fiji",
        "Solomon Islands",
        "Samoa",
        "Tonga",
        "Vanuatu",
        "Micronesia (Fed. States of)",
        "Palau",
    ],
}

DISPLAY_NAMES = {
    "Australia*": "Australia",
    "Bolivia (Plurinational State of)": "Bolivia",
    "Côte d'Ivoire": "Cote d'Ivoire",
    "Democratic Republic of the Congo": "DR Congo",
    "France*": "France",
    "Micronesia (Fed. States of)": "Micronesia",
    "Netherlands*": "Netherlands",
    "New Zealand*": "New Zealand",
    "Republic of Korea": "South Korea",
    "Spain*": "Spain",
    "Ukraine*": "Ukraine",
    "United Kingdom*": "United Kingdom",
    "United States of America*": "United States of America",
    "Venezuela (Bolivarian Republic of)": "Venezuela",
}

DATASET_OVERVIEW = [
    "International Migrant Stock 2024",
    (
        "As a part of its mandate to bring population issues to the attention of the international community, "
        "the Population Division of the United Nations, in the Department of Economic and Social Affairs, "
        "publishes datasets on the world's population and analyzes global demographic trends. The 2024 edition "
        "of the International Migrant Stock dataset presents the latest United Nations estimates of the numbers "
        "and characteristics of international migrants around the world. Covering the period from 1990 to 2024, "
        "the dataset includes estimates of the total number of international migrants by sex, as well as their "
        "places of origin and destination, for 233 countries and areas."
    ),
    (
        "In producing the 2024 edition of the International Migrant Stock dataset, the Population Division has "
        "prioritized revising the estimates for countries with new empirical information from population censuses "
        "or registers and relatively large numbers of international migrants, as well as for countries affected "
        "by ongoing or emergent refugee flows as documented by UNHCR. In the new edition of these data, a total "
        "of 60 countries and areas received a full reassessment of trends in the number of international migrants "
        "residing in the territory. For the remaining countries and areas, the estimates generated in 2024 reflect "
        "extrapolations of estimates published in the 2020 edition of the dataset."
    ),
]


app = Flask(__name__)


def parse_int(value: str) -> int:
    stripped = (value or "").strip()
    return int(stripped) if stripped.isdigit() else 0


def display_name(country: str) -> str:
    return DISPLAY_NAMES.get(country, country)


@lru_cache(maxsize=1)
def load_rows() -> list[dict]:
    rows: list[dict] = []
    with DATASET_PATH.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            cleaned = dict(row)
            for year in YEARS:
                cleaned[f"{year}_total"] = parse_int(cleaned.get(f"{year}_total", "0"))
            rows.append(cleaned)
    return rows


@lru_cache(maxsize=1)
def build_dataset_summary() -> dict:
    rows = load_rows()
    origins = {row[ORIGIN_COL] for row in rows}
    destinations = {row[DEST_COL] for row in rows}

    return {
        "time_span": "1990-2024",
        "snapshots": len(YEARS),
        "country_corridors": len(rows),
        "unique_origins": len(origins),
        "unique_destinations": len(destinations),
        "curated_countries": sum(len(countries) for countries in CONTINENT_COUNTRIES.values()),
    }


@lru_cache(maxsize=1)
def build_sankey_payload() -> dict:
    country_meta = {}
    for continent, countries in CONTINENT_COUNTRIES.items():
        for country in countries:
            country_meta[country] = {
                "continent": continent,
                "label": display_name(country),
            }

    selected_countries = set(country_meta)
    corridors = []
    for row in load_rows():
        source = row[ORIGIN_COL]
        target = row[DEST_COL]
        if source not in selected_countries or target not in selected_countries:
            continue

        values = {year: row[f"{year}_total"] for year in YEARS}
        if not any(values.values()):
            continue

        corridors.append(
            {
                "source": source,
                "target": target,
                "origin_continent": country_meta[source]["continent"],
                "destination_continent": country_meta[target]["continent"],
                "values": values,
            }
        )

    return {
        "years": YEARS,
        "continent_countries": CONTINENT_COUNTRIES,
        "country_meta": country_meta,
        "corridors": corridors,
    }


@app.context_processor
def inject_navigation():
    return {
        "nav_views": [
            {"label": "Home", "endpoint": "home"},
            {"label": "Sankey Explorer", "endpoint": "sankey_view"},
        ]
    }


@app.route("/")
def home():
    story_views = [
        {
            "title": "Continent Sankey Explorer",
            "description": (
                "Compare major migration corridors between curated origin and destination continents, "
                "then move through time from 1990 to 2024."
            ),
            "endpoint": "sankey_view",
            "status": "Available now",
        }
    ]

    return render_template(
        "home.html",
        dataset_overview=DATASET_OVERVIEW,
        summary=build_dataset_summary(),
        story_views=story_views,
        body_class="home-page",
    )


@app.route("/views/sankey")
def sankey_view():
    return render_template("sankey.html", body_class="sankey-page")


@app.route("/api/sankey-data")
def sankey_data():
    return jsonify(build_sankey_payload())


if __name__ == "__main__":
    app.run(debug=True)
