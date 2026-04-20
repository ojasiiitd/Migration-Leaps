#!/usr/bin/env python3

import csv
from pathlib import Path


LOOKUP_PATH = Path("migration_table1_country_codes.csv")
SOURCE_PATH = Path("migration_table1.csv")
OUTPUT_PATH = Path("migration_table1_countries.csv")

DEST_CODE_FIELD = "Location code of destination"
ORIGIN_CODE_FIELD = "Location code of origin"
LOOKUP_CODE_FIELD = "migration_location_code"


def load_country_codes() -> set[str]:
    with LOOKUP_PATH.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        return {row[LOOKUP_CODE_FIELD].strip() for row in reader if row[LOOKUP_CODE_FIELD].strip()}


def filter_rows(country_codes: set[str]) -> int:
    kept_rows = 0

    with SOURCE_PATH.open(newline="", encoding="utf-8-sig") as source_handle:
        reader = csv.DictReader(source_handle)
        fieldnames = list(reader.fieldnames or [])

        with OUTPUT_PATH.open("w", newline="", encoding="utf-8") as output_handle:
            writer = csv.DictWriter(output_handle, fieldnames=fieldnames)
            writer.writeheader()

            for row in reader:
                destination_code = row[DEST_CODE_FIELD].strip()
                origin_code = row[ORIGIN_CODE_FIELD].strip()

                if destination_code in country_codes and origin_code in country_codes:
                    writer.writerow(row)
                    kept_rows += 1

    return kept_rows


def main() -> None:
    country_codes = load_country_codes()
    kept_rows = filter_rows(country_codes)
    print(f"Loaded {len(country_codes)} country codes from {LOOKUP_PATH}.")
    print(f"Wrote {kept_rows} country-to-country rows to {OUTPUT_PATH}.")


if __name__ == "__main__":
    main()
