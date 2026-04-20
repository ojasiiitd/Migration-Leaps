#!/usr/bin/env python3

import csv
import json
from pathlib import Path


SOURCE_PATH = Path("migration_table1_countries_clean.csv")
OUTPUT_PATH = Path("sankey_continent_data.js")
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


def parse_int(value: str) -> int:
    stripped = (value or "").strip()
    return int(stripped) if stripped.isdigit() else 0


def build_country_meta():
    meta = {}
    for continent, countries in CONTINENT_COUNTRIES.items():
        for country in countries:
            meta[country] = {
                "continent": continent,
                "label": DISPLAY_NAMES.get(country, country),
            }
    return meta


def build_corridors(country_meta):
    selected_countries = set(country_meta)
    corridors = []

    with SOURCE_PATH.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            source = row[ORIGIN_COL]
            target = row[DEST_COL]
            if source not in selected_countries or target not in selected_countries:
                continue

            values = {year: parse_int(row[f"{year}_total"]) for year in YEARS}
            if not any(values.values()):
                continue

            corridors.append(
                {
                    "source": source,
                    "target": target,
                    "originContinent": country_meta[source]["continent"],
                    "destinationContinent": country_meta[target]["continent"],
                    "values": values,
                }
            )

    return corridors


def main():
    country_meta = build_country_meta()
    payload = {
        "years": YEARS,
        "continentCountries": CONTINENT_COUNTRIES,
        "countryMeta": country_meta,
        "corridors": build_corridors(country_meta),
    }

    js = "window.SANKEY_DATA = " + json.dumps(payload, ensure_ascii=True, indent=2) + ";\n"
    OUTPUT_PATH.write_text(js, encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}.")


if __name__ == "__main__":
    main()
