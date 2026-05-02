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
                "values_males": {year: row[f"{year}_males"] for year in YEARS},
                "values_females": {year: row[f"{year}_females"] for year in YEARS},
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
    # Track top partners: {country: {year: {partner: {inflow, outflow}}}}
    partners: dict[str, dict[str, dict[str, dict]]] = {}

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

            val = row[f"{year}_total"]
            if val == 0:
                continue
            # origin sends to dest -> origin's top inflow partner is dest, dest's top outflow partner is origin
            # For origin (as source): top destinations by outflow
            partners.setdefault(origin, {}).setdefault(year, {}).setdefault(dest, {"outflow": 0, "inflow": 0})
            partners[origin][year][dest]["outflow"] += val
            # For dest (as destination): top origins by inflow
            partners.setdefault(dest, {}).setdefault(year, {}).setdefault(origin, {"outflow": 0, "inflow": 0})
            partners[dest][year][origin]["inflow"] += val

    # Build top-5 partners per country per year
    top_partners: dict[str, dict[str, list]] = {}
    for country, years_data in partners.items():
        top_partners[country] = {}
        for year, partner_data in years_data.items():
            inflow_top = sorted(
                [(p, v["inflow"]) for p, v in partner_data.items() if v["inflow"] > 0],
                key=lambda x: x[1], reverse=True
            )[:5]
            outflow_top = sorted(
                [(p, v["outflow"]) for p, v in partner_data.items() if v["outflow"] > 0],
                key=lambda x: x[1], reverse=True
            )[:5]
            top_partners[country][year] = {
                "inflow": [{"country": display_name(p), "value": v} for p, v in inflow_top],
                "outflow": [{"country": display_name(p), "value": v} for p, v in outflow_top],
            }

    return {
        "years": YEARS,
        "records": list(result.values()),
        "top_partners": top_partners,
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
        # Cross-continent countries get multiple region entries
        regions = CROSS_CONTINENT.get(country, [country_to_continent.get(country, "Other")])
        for year, vals in years_data.items():
            net = vals["inflow"] - vals["outflow"]
            for region in regions:
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


@lru_cache(maxsize=1)
def build_diverging_bar_payload() -> dict:
    rows = load_rows()
    # Aggregate by country as destination: total males/females received
    dest_data: dict[str, dict[str, dict[str, int]]] = {}
    for row in rows:
        dest = row[DEST_COL]
        label = display_name(dest)
        if label not in dest_data:
            dest_data[label] = {y: {"males": 0, "females": 0} for y in YEARS}
        for year in YEARS:
            dest_data[label][year]["males"] += row[f"{year}_males"]
            dest_data[label][year]["females"] += row[f"{year}_females"]

    records = []
    for country, years_data in dest_data.items():
        for year, vals in years_data.items():
            total = vals["males"] + vals["females"]
            if total == 0:
                continue
            records.append({
                "country": country,
                "year": year,
                "males": vals["males"],
                "females": vals["females"],
                "total": total,
                "gap": abs(vals["males"] - vals["females"]),
                "female_ratio": vals["females"] / total if total else 0,
            })

    return {"years": YEARS, "records": records}


@lru_cache(maxsize=1)
def build_chord_payload() -> dict:
    rows = load_rows()
    # Build all-country lookup sets
    country_label: dict[str, str] = {}
    for row in rows:
        country_label[row[ORIGIN_COL]] = display_name(row[ORIGIN_COL])
        country_label[row[DEST_COL]] = display_name(row[DEST_COL])

    # Build continent→country map for coloring
    country_to_continent: dict[str, str] = {}
    for continent, countries in CONTINENT_COUNTRIES.items():
        for c in countries:
            lbl = display_name(c)
            if lbl not in country_to_continent:
                country_to_continent[lbl] = continent

    # For each year, build corridor list with volume
    corridors_by_year: dict[str, list[dict]] = {y: [] for y in YEARS}
    for row in rows:
        src_lbl = display_name(row[ORIGIN_COL])
        tgt_lbl = display_name(row[DEST_COL])
        if src_lbl == tgt_lbl:
            continue
        for year in YEARS:
            val = row[f"{year}_total"]
            if val > 0:
                corridors_by_year[year].append({
                    "source": src_lbl,
                    "target": tgt_lbl,
                    "value": val,
                })

    return {
        "years": YEARS,
        "corridors_by_year": corridors_by_year,
        "country_to_continent": country_to_continent,
    }


@lru_cache(maxsize=1)
def build_streamgraph_payload() -> dict:
    rows = load_rows()

    # Outflow: for each origin, aggregate by destination
    # Inflow: for each destination, aggregate by origin
    outflow: dict[str, dict[str, dict[str, int]]] = {}  # origin → dest → year → total
    inflow: dict[str, dict[str, dict[str, int]]] = {}   # dest → origin → year → total

    for row in rows:
        src = display_name(row[ORIGIN_COL])
        tgt = display_name(row[DEST_COL])
        if src == tgt:
            continue
        for year in YEARS:
            val = row[f"{year}_total"]
            if val == 0:
                continue
            outflow.setdefault(src, {}).setdefault(tgt, {y: 0 for y in YEARS})
            outflow[src][tgt][year] += val
            inflow.setdefault(tgt, {}).setdefault(src, {y: 0 for y in YEARS})
            inflow[tgt][src][year] += val

    # Flatten to records
    outflow_records = []
    for origin, dests in outflow.items():
        for dest, years_data in dests.items():
            outflow_records.append({
                "country": origin,
                "partner": dest,
                "values": years_data,
            })

    inflow_records = []
    for dest, origins in inflow.items():
        for origin, years_data in origins.items():
            inflow_records.append({
                "country": dest,
                "partner": origin,
                "values": years_data,
            })

    # All unique country names
    all_countries = sorted(set(
        list(outflow.keys()) + list(inflow.keys())
    ))

    return {
        "years": YEARS,
        "outflow_records": outflow_records,
        "inflow_records": inflow_records,
        "countries": all_countries,
    }


@app.context_processor
def inject_navigation():
    return {
        "nav_views": [
            {"label": "Home", "endpoint": "home", "group": "home"},
            {"label": "Sankey Explorer",   "endpoint": "sankey_view",       "group": "viz"},
            {"label": "Choropleth Map",    "endpoint": "choropleth_view",   "group": "viz"},
            {"label": "Net Migration",     "endpoint": "netflow_view",      "group": "viz"},
            {"label": "Diverging Bar",     "endpoint": "diverging_bar_view","group": "viz"},
            {"label": "Chord Diagram",     "endpoint": "chord_view",        "group": "viz"},
            {"label": "Streamgraph",       "endpoint": "streamgraph_view",  "group": "viz"},
            {"label": "Dashboard 1", "endpoint": "dashboard_view",  "group": "dashboards"},
            {"label": "Dashboard 2", "endpoint": "dashboard2_view", "group": "dashboards"},
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


@app.route("/views/dashboard")
def dashboard_view():
    return render_template("dashboard.html", body_class="dashboard-page")


@app.route("/views/diverging-bar")
def diverging_bar_view():
    return render_template("diverging_bar.html", body_class="diverging-bar-page")


@app.route("/views/chord")
def chord_view():
    return render_template("chord.html", body_class="chord-page")


@app.route("/views/streamgraph")
def streamgraph_view():
    return render_template("streamgraph.html", body_class="streamgraph-page")


@app.route("/views/dashboard2")
def dashboard2_view():
    return render_template("dashboard2.html", body_class="dashboard2-page")


@app.route("/api/sankey-data")
def sankey_data():
    return jsonify(build_sankey_payload())


@app.route("/api/choropleth-data")
def choropleth_data():
    return jsonify(build_choropleth_payload())


@app.route("/api/netflow-data")
def netflow_data():
    return jsonify(build_netflow_payload())


@app.route("/api/diverging-bar-data")
def diverging_bar_data():
    return jsonify(build_diverging_bar_payload())


@app.route("/api/chord-data")
def chord_data():
    return jsonify(build_chord_payload())


@app.route("/api/streamgraph-data")
def streamgraph_data():
    return jsonify(build_streamgraph_payload())


@lru_cache(maxsize=1)
def build_dashboard2_payload() -> dict:
    bar = build_diverging_bar_payload()
    chord = build_chord_payload()
    stream = build_streamgraph_payload()

    # Find top country by 2024 outflow for default selection
    outflow_2024: dict[str, int] = {}
    for rec in stream["outflow_records"]:
        outflow_2024[rec["country"]] = outflow_2024.get(rec["country"], 0) + sum(
            rec["values"].get(y, 0) for y in ["2024"]
        )
    top_country = max(outflow_2024, key=lambda c: outflow_2024[c]) if outflow_2024 else None

    return {
        "years": YEARS,
        "bar_records": bar["records"],
        "corridors_by_year": chord["corridors_by_year"],
        "country_to_continent": chord["country_to_continent"],
        "outflow_records": stream["outflow_records"],
        "inflow_records": stream["inflow_records"],
        "countries": stream["countries"],
        "top_country": top_country,
    }


@app.route("/api/dashboard2-data")
def dashboard2_data():
    return jsonify(build_dashboard2_payload())


if __name__ == "__main__":
    app.run(debug=True)
