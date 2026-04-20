#!/usr/bin/env python3

from pathlib import Path

import holoviews as hv
import hvplot.pandas  # noqa: F401
import pandas as pd
import panel as pn

hv.extension("bokeh")
pn.extension("tabulator")


DATA_PATH = Path("migration_table1_countries_clean.csv")
YEAR_OPTIONS = ["1990", "1995", "2000", "2005", "2010", "2015", "2020", "2024"]
MEASURE_OPTIONS = {
    "Total": "total",
    "Males": "males",
    "Females": "females",
}

DESTINATION_COL = "Region, development group, country or area of destination"
ORIGIN_COL = "Region, development group, country or area of origin"
DESTINATION_CODE_COL = "Location code of destination"
ORIGIN_CODE_COL = "Location code of origin"


def load_data() -> pd.DataFrame:
    frame = pd.read_csv(DATA_PATH)

    numeric_columns = [
        column
        for column in frame.columns
        if any(column.endswith(f"_{suffix}") for suffix in ("total", "males", "females"))
    ]
    for column in numeric_columns:
        frame[column] = pd.to_numeric(frame[column], errors="coerce").fillna(0).astype(int)

    frame["corridor"] = frame[ORIGIN_COL] + " -> " + frame[DESTINATION_COL]
    return frame


df = load_data()
country_options = sorted(
    set(df[ORIGIN_COL].dropna().unique()).union(df[DESTINATION_COL].dropna().unique())
)

year = pn.widgets.Select(name="Year", options=YEAR_OPTIONS, value="2024")
measure = pn.widgets.Select(name="Measure", options=MEASURE_OPTIONS, value="total")
top_n = pn.widgets.IntSlider(name="Top Corridors", start=10, end=100, step=5, value=30)
min_flow = pn.widgets.IntSlider(name="Minimum Flow", start=0, end=500000, step=5000, value=10000)
country = pn.widgets.AutocompleteInput(
    name="Focus Country",
    options=country_options,
    case_sensitive=False,
    search_strategy="includes",
    placeholder="Optional",
)
mode = pn.widgets.RadioButtonGroup(
    name="Country Filter",
    options={
        "Any corridor involving country": "either",
        "Origin only": "origin",
        "Destination only": "destination",
    },
    button_type="success",
    value="either",
)


def selected_value_column(selected_year: str, selected_measure: str) -> str:
    return f"{selected_year}_{selected_measure}"


def filter_data(
    selected_year: str,
    selected_measure: str,
    selected_country: str,
    selected_mode: str,
    selected_top_n: int,
    selected_min_flow: int,
    apply_top_n: bool = True,
) -> pd.DataFrame:
    value_column = selected_value_column(selected_year, selected_measure)
    filtered = df[[ORIGIN_COL, DESTINATION_COL, ORIGIN_CODE_COL, DESTINATION_CODE_COL, "corridor", value_column]].copy()
    filtered = filtered.rename(columns={value_column: "flow"})
    filtered = filtered[filtered["flow"] >= selected_min_flow]

    if selected_country:
        if selected_mode == "origin":
            filtered = filtered[filtered[ORIGIN_COL] == selected_country]
        elif selected_mode == "destination":
            filtered = filtered[filtered[DESTINATION_COL] == selected_country]
        else:
            filtered = filtered[
                (filtered[ORIGIN_COL] == selected_country)
                | (filtered[DESTINATION_COL] == selected_country)
            ]

    if apply_top_n:
        filtered = filtered.sort_values("flow", ascending=False).head(selected_top_n)
    return filtered


@pn.cache
def country_summary_table(selected_year: str, selected_measure: str) -> pd.DataFrame:
    value_column = selected_value_column(selected_year, selected_measure)
    inbound = (
        df.groupby(DESTINATION_COL, as_index=False)[value_column]
        .sum()
        .rename(columns={DESTINATION_COL: "country", value_column: "inbound"})
    )
    outbound = (
        df.groupby(ORIGIN_COL, as_index=False)[value_column]
        .sum()
        .rename(columns={ORIGIN_COL: "country", value_column: "outbound"})
    )
    summary = inbound.merge(outbound, on="country", how="outer").fillna(0)
    summary["net"] = summary["inbound"] - summary["outbound"]
    return summary


def build_sankey_data(filtered: pd.DataFrame, selected_top_n: int) -> pd.DataFrame:
    grouped = (
        filtered.groupby([ORIGIN_COL, DESTINATION_COL], as_index=False)["flow"]
        .sum()
    )
    grouped = grouped[grouped[ORIGIN_COL] != grouped[DESTINATION_COL]].copy()
    if grouped.empty:
        return grouped

    grouped["pair_key"] = grouped.apply(
        lambda row: tuple(sorted((row[ORIGIN_COL], row[DESTINATION_COL]))),
        axis=1,
    )

    net_rows = []
    for _, pair in grouped.groupby("pair_key", sort=False):
        pair = pair.sort_values("flow", ascending=False).reset_index(drop=True)
        if len(pair) == 1:
            net_rows.append(
                {
                    ORIGIN_COL: pair.loc[0, ORIGIN_COL],
                    DESTINATION_COL: pair.loc[0, DESTINATION_COL],
                    "flow": int(pair.loc[0, "flow"]),
                }
            )
            continue

        first = pair.loc[0]
        second = pair.loc[1]
        net_flow = int(first["flow"] - second["flow"])
        if net_flow <= 0:
            continue

        net_rows.append(
            {
                ORIGIN_COL: first[ORIGIN_COL],
                DESTINATION_COL: first[DESTINATION_COL],
                "flow": net_flow,
            }
        )

    if not net_rows:
        return pd.DataFrame(columns=[ORIGIN_COL, DESTINATION_COL, "flow"])

    sankey_data = pd.DataFrame(net_rows).sort_values("flow", ascending=False).head(selected_top_n)
    return sankey_data


@pn.depends(year, measure, country, mode, top_n, min_flow)
def sankey_view(selected_year, selected_measure, selected_country, selected_mode, selected_top_n, selected_min_flow):
    filtered = filter_data(
        selected_year,
        selected_measure,
        selected_country,
        selected_mode,
        selected_top_n,
        selected_min_flow,
        apply_top_n=False,
    )
    sankey_data = build_sankey_data(filtered, selected_top_n)
    if sankey_data.empty:
        return pn.pane.Markdown("No corridors match the current filters.")

    sankey = hv.Sankey(sankey_data, kdims=[ORIGIN_COL, DESTINATION_COL], vdims=["flow"]).opts(
        width=1100,
        height=650,
        cmap="Category20",
        edge_color="source",
        node_color="index",
        label_position="left",
        fontsize={"labels": 10, "title": 14},
        title=f"Migration Sankey: {selected_year} {selected_measure.title()}",
    )
    return pn.pane.HoloViews(sankey, sizing_mode="stretch_width")


@pn.depends(year, measure, country, mode, top_n, min_flow)
def corridor_bar_view(selected_year, selected_measure, selected_country, selected_mode, selected_top_n, selected_min_flow):
    filtered = filter_data(
        selected_year,
        selected_measure,
        selected_country,
        selected_mode,
        selected_top_n,
        selected_min_flow,
    )
    if filtered.empty:
        return pn.pane.Markdown("No bar chart available for the current filters.")

    bars = (
        filtered.sort_values("flow", ascending=True)
        .hvplot.barh(
            x="corridor",
            y="flow",
            height=max(400, 18 * len(filtered)),
            width=1100,
            color="#2a9d8f",
            xlabel="Migration corridor",
            ylabel="People",
            title=f"Top Corridors: {selected_year} {selected_measure.title()}",
        )
        .opts(toolbar=None)
    )
    return pn.pane.HoloViews(bars, sizing_mode="stretch_width")


@pn.depends(year, measure, country)
def country_balance_view(selected_year, selected_measure, selected_country):
    summary = country_summary_table(selected_year, selected_measure).copy()

    if selected_country:
        summary = summary[summary["country"] == selected_country]
    else:
        summary = summary.reindex(summary["net"].abs().sort_values(ascending=False).index).head(20)

    if summary.empty:
        return pn.pane.Markdown("No country balance data available.")

    melted = summary.melt(
        id_vars="country",
        value_vars=["inbound", "outbound"],
        var_name="direction",
        value_name="flow",
    )
    chart = (
        melted.hvplot.barh(
            x="country",
            y="flow",
            by="direction",
            stacked=False,
            width=1100,
            height=max(400, 24 * len(summary)),
            title=f"Inbound vs Outbound: {selected_year} {selected_measure.title()}",
            legend="top_right",
        )
        .opts(toolbar=None)
    )
    return pn.pane.HoloViews(chart, sizing_mode="stretch_width")


@pn.depends(year, measure, country, mode, top_n, min_flow)
def data_table_view(selected_year, selected_measure, selected_country, selected_mode, selected_top_n, selected_min_flow):
    filtered = filter_data(
        selected_year,
        selected_measure,
        selected_country,
        selected_mode,
        selected_top_n,
        selected_min_flow,
    )
    if filtered.empty:
        return pn.pane.Markdown("No rows to display.")

    table = filtered.rename(
        columns={
            ORIGIN_COL: "origin",
            DESTINATION_COL: "destination",
        }
    )[["origin", "destination", "flow"]]
    return pn.widgets.Tabulator(table, pagination="local", page_size=15, sizing_mode="stretch_width")


intro = pn.pane.Markdown(
    """
# Global Migration Explorer

This PyViz app uses `migration_table1_countries_clean.csv` to explore country-to-country migration corridors.
Use the filters to switch year, gender split, corridor threshold, and optional country focus.
""",
    sizing_mode="stretch_width",
)

controls = pn.WidgetBox(
    "## Controls",
    year,
    measure,
    top_n,
    min_flow,
    country,
    mode,
    width=320,
)

layout = pn.template.FastListTemplate(
    title="Migration PyViz Explorer",
    sidebar=[controls],
    main=[
        intro,
        pn.Tabs(
            ("Sankey", sankey_view),
            ("Top Corridors", corridor_bar_view),
            ("Country Balance", country_balance_view),
            ("Data Table", data_table_view),
        ),
    ],
    accent_base_color="#2a9d8f",
    header_background="#264653",
)

layout.servable()
