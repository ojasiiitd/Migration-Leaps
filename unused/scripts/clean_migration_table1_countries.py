#!/usr/bin/env python3

import csv
from pathlib import Path


SOURCE_PATH = Path("migration_table1_countries.csv")
OUTPUT_PATH = Path("migration_table1_countries_clean.csv")

BASE_COLUMNS = [
    "Index",
    "Region, development group, country or area of destination",
    "Coverage",
    "Data type",
    "Location code of destination",
    "Region, development group, country or area of origin",
    "Location code of origin",
]

YEARS = ["1990", "1995", "2000", "2005", "2010", "2015", "2020", "2024"]
YEAR_GROUP_SUFFIXES = ["total", "males", "females"]


def build_clean_header() -> list[str]:
    clean_header = list(BASE_COLUMNS)
    for suffix in YEAR_GROUP_SUFFIXES:
        for year in YEARS:
            clean_header.append(f"{year}_{suffix}")
    return clean_header


def clean_numeric_text(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        return ""
    return stripped.replace(" ", "")


def main() -> None:
    clean_header = build_clean_header()
    cleaned_rows = 0

    with SOURCE_PATH.open(newline="", encoding="utf-8-sig") as source_handle:
        reader = csv.reader(source_handle)
        original_header = next(reader)

        if len(original_header) != len(clean_header):
            raise ValueError(
                f"Expected {len(clean_header)} columns but found {len(original_header)}."
            )

        with OUTPUT_PATH.open("w", newline="", encoding="utf-8") as output_handle:
            writer = csv.writer(output_handle)
            writer.writerow(clean_header)

            for row in reader:
                if len(row) != len(clean_header):
                    raise ValueError(
                        f"Row has {len(row)} columns, expected {len(clean_header)}: {row[:3]}"
                    )

                cleaned_row = []
                for index, value in enumerate(row):
                    if index in {0, 4, 6} or index >= len(BASE_COLUMNS):
                        cleaned_row.append(clean_numeric_text(value))
                    else:
                        cleaned_row.append(value.strip())

                writer.writerow(cleaned_row)
                cleaned_rows += 1

    print(f"Wrote {cleaned_rows} cleaned rows to {OUTPUT_PATH}.")


if __name__ == "__main__":
    main()
