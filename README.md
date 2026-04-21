<div align="center">

# Mapping Global Migration Flows

**Telling stories through the movement of people**

</div>

---

Migration data is full of stories — of displacement, opportunity, and connection across borders. This project turns decades of bilateral migration statistics into interactive narratives, letting you explore who moves, where they go, and how those flows have shifted over time.

## What's inside

| View | Story it tells |
|---|---|
| **Choropleth** | Which countries send or receive the most migrants |
| **Sankey** | How migration flows between regions |
| **Net Flow** | Where countries stand as sources vs. destinations |
| **Dashboard** | A combined view for cross-cutting exploration |

## Stack

- **Backend** — Python / Flask
- **Frontend** — D3.js (via Jinja templates)
- **Data** — UN bilateral migration stock tables + population data

## Running locally

```bash
pip install -r requirements.txt
python app.py
```

Then open `http://localhost:5000`.

## Data

- `migration_table1_countries_clean.csv` — bilateral migrant stock by country pair
- `population_cleaned.csv` — country population over time
- `unique_regions_codes.csv` — region/country code mappings
