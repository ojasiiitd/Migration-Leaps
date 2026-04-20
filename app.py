#!/usr/bin/env python3

from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path

from flask import Flask, jsonify, render_template


BASE_DIR = Path(__file__).resolve().parent
DATASET_PATH = BASE_DIR / "migration_table1_countries_clean.csv"
POPULATION_PATH = BASE_DIR / "population_cleaned.csv"

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
        "Russian Federation",
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

CROSS_CONTINENT = {
    "Russian Federation": ["Asia", "Europe"],
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


@app.template_filter("approx")
def approx_filter(n: int) -> str:
    n = int(n)
    if n >= 10_000_000:
        return f"~{n / 10_000_000:.1f} Cr"
    elif n >= 100_000:
        return f"~{n / 100_000:.1f} L"
    return f"~{n:,}"


def parse_int(value: str) -> int:
    stripped = (value or "").strip()
    return int(stripped) if stripped.isdigit() else 0


def display_name(country: str) -> str:
    return DISPLAY_NAMES.get(country, country)


@lru_cache(maxsize=1)
def load_population() -> dict[str, int]:
    """Returns {year_str: global_population} using the 'World' aggregate row."""
    totals: dict[str, int] = {}
    with POPULATION_PATH.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            if row.get("Country Name", "").strip() != "World":
                continue
            year = str(int(float(row["Year"])))
            try:
                val = int(float(row["Value"]))
            except (ValueError, KeyError):
                val = 0
            totals[year] = val
    return totals


@lru_cache(maxsize=1)
def load_rows() -> list[dict]:
    rows: list[dict] = []
    with DATASET_PATH.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            cleaned = dict(row)
            for year in YEARS:
                cleaned[f"{year}_total"] = parse_int(cleaned.get(f"{year}_total", "0"))
                cleaned[f"{year}_males"] = parse_int(cleaned.get(f"{year}_males", "0"))
                cleaned[f"{year}_females"] = parse_int(cleaned.get(f"{year}_females", "0"))
            rows.append(cleaned)
    return rows


@lru_cache(maxsize=1)
def build_dataset_summary() -> dict:
    rows = load_rows()
    origins = {row[ORIGIN_COL] for row in rows}
    destinations = {row[DEST_COL] for row in rows}
    countries = origins | destinations

    totals_by_year  = {year: sum(row[f"{year}_total"]   for row in rows) for year in YEARS}
    males_by_year   = {year: sum(row[f"{year}_males"]   for row in rows) for year in YEARS}
    females_by_year = {year: sum(row[f"{year}_females"] for row in rows) for year in YEARS}

    peak_year = max(YEARS, key=lambda year: totals_by_year[year])
    start_total = totals_by_year[YEARS[0]]
    end_total = totals_by_year[YEARS[-1]]
    absolute_growth = end_total - start_total
    growth_pct = (absolute_growth / start_total * 100) if start_total else 0

    origin_2024 = {}
    destination_2024 = {}
    for row in rows:
        origin_2024[row[ORIGIN_COL]] = origin_2024.get(row[ORIGIN_COL], 0) + row["2024_total"]
        destination_2024[row[DEST_COL]] = destination_2024.get(row[DEST_COL], 0) + row["2024_total"]

    top_origins_2024 = sorted(origin_2024.items(), key=lambda item: item[1], reverse=True)[:3]
    top_destinations_2024 = sorted(destination_2024.items(), key=lambda item: item[1], reverse=True)[:3]
    top_origin_2024 = top_origins_2024[0]
    top_destination_2024 = top_destinations_2024[0]

    active_corridors_2024 = sum(1 for row in rows if row["2024_total"] > 0)

    yearly_overview = []
    max_total = max(totals_by_year.values()) if totals_by_year else 0
    for year in YEARS:
        total   = totals_by_year[year]
        males   = males_by_year[year]
        females = females_by_year[year]
        yearly_overview.append(
            {
                "year": year,
                "total": total,
                "males": males,
                "females": females,
                "bar_width":        (total   / max_total * 100) if max_total else 0,
                "male_bar_width":   (males   / max_total * 100) if max_total else 0,
                "female_bar_width": (females / max_total * 100) if max_total else 0,
            }
        )

    return {
        "time_span": "1990-2024",
        "snapshots": len(YEARS),
        "country_corridors": len(rows),
        "countries_covered": len(countries),
        "unique_origins": len(origins),
        "unique_destinations": len(destinations),
        "curated_countries": sum(len(countries) for countries in CONTINENT_COUNTRIES.values()),
        "total_1990": start_total,
        "total_2024": end_total,
        "absolute_growth": absolute_growth,
        "growth_pct": growth_pct,
        "peak_year": peak_year,
        "top_origin_2024": {"country": display_name(top_origin_2024[0]), "value": top_origin_2024[1]},
        "top_destination_2024": {
            "country": display_name(top_destination_2024[0]),
            "value": top_destination_2024[1],
        },
        "top_3_origins_2024": [{"country": display_name(c), "value": v} for c, v in top_origins_2024],
        "top_3_destinations_2024": [{"country": display_name(c), "value": v} for c, v in top_destinations_2024],
        "active_corridors_2024": active_corridors_2024,
        "yearly_overview": yearly_overview,
    }


@lru_cache(maxsize=1)
def build_sankey_payload() -> dict:
    country_meta = {}
    country_continents: dict[str, list[str]] = {}
    for continent, countries in CONTINENT_COUNTRIES.items():
        for country in countries:
            if country not in country_continents:
                country_continents[country] = []
            country_continents[country].append(continent)
            country_meta[country] = {
                "continent": country_continents[country][0],
                "continents": country_continents[country],
                "label": display_name(country),
                "cross_continent": country in CROSS_CONTINENT,
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
                "origin_continents": country_continents[source],
                "destination_continents": country_continents[target],
                "values": values,
            }
        )

    return {
        "years": YEARS,
        "continent_countries": CONTINENT_COUNTRIES,
        "country_meta": country_meta,
        "cross_continent": CROSS_CONTINENT,
        "corridors": corridors,
    }


@lru_cache(maxsize=1)
def build_choropleth_payload() -> dict:
    rows = load_rows()
    result: dict[str, dict] = {}

    for row in rows:
        origin = row[ORIGIN_COL]
        dest = row[DEST_COL]
        for year in YEARS:
            key_o = f"{origin}||{year}"
            if key_o not in result:
                result[key_o] = {"country": origin, "year": year, "outflow_total": 0, "outflow_males": 0, "outflow_females": 0, "inflow_total": 0, "inflow_males": 0, "inflow_females": 0}
            result[key_o]["outflow_total"] += row[f"{year}_total"]
            result[key_o]["outflow_males"] += row[f"{year}_males"]
            result[key_o]["outflow_females"] += row[f"{year}_females"]

            key_d = f"{dest}||{year}"
            if key_d not in result:
                result[key_d] = {"country": dest, "year": year, "outflow_total": 0, "outflow_males": 0, "outflow_females": 0, "inflow_total": 0, "inflow_males": 0, "inflow_females": 0}
            result[key_d]["inflow_total"] += row[f"{year}_total"]
            result[key_d]["inflow_males"] += row[f"{year}_males"]
            result[key_d]["inflow_females"] += row[f"{year}_females"]

    return {
        "years": YEARS,
        "records": list(result.values()),
    }


@lru_cache(maxsize=1)
def build_netflow_payload() -> dict:
    rows = load_rows()
    data: dict[str, dict[str, dict]] = {}

    # Build country->continent mapping
    country_to_continent: dict[str, str] = {}
    for continent, countries in CONTINENT_COUNTRIES.items():
        for c in countries:
            if c not in country_to_continent:
                country_to_continent[c] = continent

    for row in rows:
        origin = row[ORIGIN_COL]
        dest = row[DEST_COL]
        for year in YEARS:
            for country in [origin, dest]:
                if country not in data:
                    data[country] = {y: {"inflow": 0, "outflow": 0} for y in YEARS}
            data[origin][year]["outflow"] += row[f"{year}_total"]
            data[dest][year]["inflow"] += row[f"{year}_total"]

    records = []
    for country, years_data in data.items():
        region = country_to_continent.get(country, "Other")
        for year, vals in years_data.items():
            net = vals["inflow"] - vals["outflow"]
            records.append({
                "country": display_name(country),
                "country_raw": country,
                "year": year,
                "region": region,
                "inflow": vals["inflow"],
                "outflow": vals["outflow"],
                "net": net,
            })

    return {
        "years": YEARS,
        "records": records,
    }


@app.context_processor
def inject_navigation():
    return {
        "nav_views": [
            {"label": "Home", "endpoint": "home"},
            {"label": "Sankey Explorer", "endpoint": "sankey_view"},
            {"label": "Choropleth Map", "endpoint": "choropleth_view"},
            {"label": "Net Migration", "endpoint": "netflow_view"},
        ]
    }


def build_global_trend_data() -> list[dict]:
    """Yearly migrant stock + population share for dual-axis chart (all years 1990-2024)."""
    rows = load_rows()
    pop = load_population()

    # All years in dataset
    all_years = [str(y) for y in range(1990, 2025)]
    # Migrant totals only for snapshot years
    migrant_snap = {year: sum(row[f"{year}_total"] for row in rows) for year in YEARS}

    result = []
    for year in all_years:
        migrants = migrant_snap.get(year)
        population = pop.get(year, 0)
        pct = (migrants / population * 100) if (migrants and population) else None
        result.append({
            "year": int(year),
            "migrants": migrants,
            "population": population,
            "pct": round(pct, 2) if pct is not None else None,
        })
    return result


def build_leading_destinations_data() -> dict:
    """Migrant stock in millions for 12 leading destination countries across 5 years."""
    rows = load_rows()
    target_years = ["1990", "2000", "2010", "2020", "2024"]
    countries = [
        "United States of America*",
        "Germany",
        "Saudi Arabia",
        "United Kingdom*",
        "France*",
        "Spain*",
        "Canada",
        "United Arab Emirates",
        "Australia*",
        "Russian Federation",
        "Türkiye",
        "Italy",
    ]

    # Sum inflows (as destination) per country per year
    dest_totals: dict[str, dict[str, int]] = {c: {y: 0 for y in target_years} for c in countries}
    for row in rows:
        dest = row[DEST_COL]
        for c in countries:
            if dest == c:
                for y in target_years:
                    dest_totals[c][y] += row[f"{y}_total"]

    result = []
    for c in countries:
        label = DISPLAY_NAMES.get(c, c)
        result.append({
            "country": label,
            "values": {y: round(dest_totals[c][y] / 1_000_000, 2) for y in target_years},
        })
    return {"countries": result, "years": target_years}


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
        },
        {
            "title": "Choropleth Map",
            "description": "World map colored by immigrant or emigrant density, with year and gender filters.",
            "endpoint": "choropleth_view",
            "status": "Available now",
        },
        {
            "title": "Net Migration Balance",
            "description": "Bar chart of top net gainers and losers by year and region.",
            "endpoint": "netflow_view",
            "status": "Available now",
        },
    ]

    import json
    global_trend = build_global_trend_data()
    leading_dest = build_leading_destinations_data()

    return render_template(
        "home.html",
        dataset_overview=DATASET_OVERVIEW,
        summary=build_dataset_summary(),
        story_views=story_views,
        global_trend_json=json.dumps(global_trend),
        leading_dest_json=json.dumps(leading_dest),
        body_class="home-page",
    )


@app.route("/views/sankey")
def sankey_view():
    return render_template("sankey.html", body_class="sankey-page")


@app.route("/views/choropleth")
def choropleth_view():
    return render_template("choropleth.html", body_class="choropleth-page")


@app.route("/views/netflow")
def netflow_view():
    return render_template("netflow.html", body_class="netflow-page")


@app.route("/api/sankey-data")
def sankey_data():
    return jsonify(build_sankey_payload())


@app.route("/api/choropleth-data")
def choropleth_data():
    return jsonify(build_choropleth_payload())


@app.route("/api/netflow-data")
def netflow_data():
    return jsonify(build_netflow_payload())


if __name__ == "__main__":
    app.run(debug=True)
