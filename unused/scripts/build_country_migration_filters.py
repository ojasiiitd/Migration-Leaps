#!/usr/bin/env python3

import csv
import re
import unicodedata
from pathlib import Path


COUNTRIES_PATH = Path("countries.csv")
MIGRATION_PATH = Path("migration_table1.csv")
LOOKUP_OUTPUT_PATH = Path("migration_table1_country_codes.csv")
FILTERED_OUTPUT_PATH = Path("migration_table1_country_to_country.csv")

DEST_NAME_FIELD = "Region, development group, country or area of destination"
DEST_CODE_FIELD = "Location code of destination"
ORIGIN_NAME_FIELD = "Region, development group, country or area of origin"
ORIGIN_CODE_FIELD = "Location code of origin"


ALIASES = {
    "british virgin islands": "Virgin Islands, British",
    "cabo verde": "Cape Verde",
    "china hong kong sar": "Hong Kong",
    "china macao sar": "Macao",
    "china taiwan province of china": "Taiwan, Province of China",
    "czechia": "Czech Republic",
    "dem people s republic of korea": "Korea, Democratic People's Republic of",
    "democratic republic of the congo": "Congo, the Democratic Republic of the",
    "holy see": "Holy See (Vatican City State)",
    "micronesia fed states of": "Micronesia, Federated States of",
    "north macedonia": "Macedonia, the Former Yugoslav Republic of",
    "republic of korea": "Korea, Republic of",
    "republic of moldova": "Moldova, Republic of",
    "saint helena": "Saint Helena, Ascension and Tristan da Cunha",
    "state of palestine": "Palestine, State of",
    "turkiye": "Turkey",
    "united republic of tanzania": "Tanzania, United Republic of",
    "united states of america": "United States",
    "united states virgin islands": "Virgin Islands, U.S.",
    "wallis and futuna islands": "Wallis and Futuna",
}


def normalize_name(value: str) -> str:
    ascii_value = (
        unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    )
    ascii_value = ascii_value.replace("&", " and ")
    ascii_value = ascii_value.replace("*", " ")
    ascii_value = ascii_value.lower()
    ascii_value = re.sub(r"[^a-z0-9]+", " ", ascii_value)
    return " ".join(ascii_value.split())


def load_country_reference():
    with COUNTRIES_PATH.open(newline="", encoding="utf-8-sig") as handle:
        countries = list(csv.DictReader(handle))

    by_normalized_name = {}
    for row in countries:
        by_normalized_name[normalize_name(row["Name"])] = row

    return countries, by_normalized_name


def resolve_country(name: str, by_normalized_name: dict):
    normalized = normalize_name(name)
    canonical_name = None

    if normalized in by_normalized_name:
        canonical_name = by_normalized_name[normalized]["Name"]
    elif normalized in ALIASES:
        canonical_name = ALIASES[normalized]

    if canonical_name is None:
        return None

    return by_normalized_name[normalize_name(canonical_name)]


def collect_country_lookup(by_normalized_name: dict):
    lookup = {}

    with MIGRATION_PATH.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            for name_field, code_field, role in [
                (DEST_NAME_FIELD, DEST_CODE_FIELD, "destination"),
                (ORIGIN_NAME_FIELD, ORIGIN_CODE_FIELD, "origin"),
            ]:
                migration_name = row[name_field]
                migration_code = row[code_field]
                country = resolve_country(migration_name, by_normalized_name)
                if country is None:
                    continue

                entry = lookup.setdefault(
                    migration_code,
                    {
                        "migration_location_code": migration_code,
                        "migration_location_name": migration_name,
                        "country_name": country["Name"],
                        "country_code": country["Code"],
                        "appears_as_destination": "no",
                        "appears_as_origin": "no",
                    },
                )

                if role == "destination":
                    entry["appears_as_destination"] = "yes"
                else:
                    entry["appears_as_origin"] = "yes"

    return sorted(lookup.values(), key=lambda row: int(row["migration_location_code"]))


def write_country_lookup(rows):
    fieldnames = [
        "migration_location_code",
        "migration_location_name",
        "country_name",
        "country_code",
        "appears_as_destination",
        "appears_as_origin",
    ]
    with LOOKUP_OUTPUT_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_filtered_migration(by_normalized_name: dict):
    kept_rows = 0
    with MIGRATION_PATH.open(newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        fieldnames = list(reader.fieldnames or [])
        extra_fields = [
            "destination_country_name",
            "destination_country_code",
            "origin_country_name",
            "origin_country_code",
        ]

        with FILTERED_OUTPUT_PATH.open("w", newline="", encoding="utf-8") as target:
            writer = csv.DictWriter(target, fieldnames=fieldnames + extra_fields)
            writer.writeheader()

            for row in reader:
                destination = resolve_country(row[DEST_NAME_FIELD], by_normalized_name)
                origin = resolve_country(row[ORIGIN_NAME_FIELD], by_normalized_name)
                if destination is None or origin is None:
                    continue

                row["destination_country_name"] = destination["Name"]
                row["destination_country_code"] = destination["Code"]
                row["origin_country_name"] = origin["Name"]
                row["origin_country_code"] = origin["Code"]
                writer.writerow(row)
                kept_rows += 1

    return kept_rows


def main():
    _, by_normalized_name = load_country_reference()
    lookup_rows = collect_country_lookup(by_normalized_name)
    write_country_lookup(lookup_rows)
    kept_rows = write_filtered_migration(by_normalized_name)

    print(f"Wrote {LOOKUP_OUTPUT_PATH} with {len(lookup_rows)} country-coded locations.")
    print(f"Wrote {FILTERED_OUTPUT_PATH} with {kept_rows} country-to-country rows.")


if __name__ == "__main__":
    main()
