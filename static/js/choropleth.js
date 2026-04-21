(function () {
  const root = document.getElementById("choropleth-app");
  if (!root) return;

  const endpoint = root.dataset.endpoint;
  const svgEl = document.getElementById("map-svg");
  const tooltipEl = document.getElementById("tooltip");
  const yearSlider = document.getElementById("year-slider");
  const yearChip = document.getElementById("year-chip");
  const vizSummary = document.getElementById("viz-summary");
  const mapModeLabelEl = document.getElementById("map-mode-label");
  const mapSubtitleEl = document.getElementById("map-subtitle");
  const yearDisplayEl = document.getElementById("year-display");
  const genderDisplayEl = document.getElementById("gender-display");
  const legendEl = document.getElementById("map-legend");

  let apiData = null;
  let geoFeatures = null;
  let state = {
    mode: "destination",
    year: "2024",
    gender: "total",
  };

  let lookup = {};
  let normalizedLookup = {};
  let topPartnersLookup = {}; // normalizedCountryName -> {year -> {inflow, outflow}}

  function normalizeName(name) {
    return (name || "")
      .toLowerCase()
      .replace(/\*/g, "")
      .replace(/\(.*?\)/g, "")
      .replace(/,\s*.*/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildLookup() {
    lookup = {};
    apiData.records.forEach((r) => {
      if (!lookup[r.country]) lookup[r.country] = {};
      lookup[r.country][r.year] = r;
    });
    normalizedLookup = {};
    Object.keys(lookup).forEach((name) => {
      normalizedLookup[normalizeName(name)] = name;
    });

    // Build top partners lookup keyed by normalized name for geo matching
    topPartnersLookup = {};
    if (apiData.top_partners) {
      Object.entries(apiData.top_partners).forEach(([rawName, yearsData]) => {
        topPartnersLookup[normalizeName(rawName)] = yearsData;
      });
    }
  }

  function matchName(geoName) {
    const norm = normalizeName(geoName);
    if (normalizedLookup[norm]) return normalizedLookup[norm];
    // Partial match attempts
    for (const [k, v] of Object.entries(normalizedLookup)) {
      if (norm === k) return v;
    }
    for (const [k, v] of Object.entries(normalizedLookup)) {
      if (k.startsWith(norm) || norm.startsWith(k)) return v;
    }
    return null;
  }

  function getVal(countryName) {
    const entry = lookup[countryName]?.[state.year];
    if (!entry) return 0;
    const suffix = state.gender === "total" ? "_total" : `_${state.gender}`;
    return state.mode === "destination" ? (entry[`inflow${suffix}`] || 0) : (entry[`outflow${suffix}`] || 0);
  }

  function approxFormat(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toString();
  }

  function renderLegend(colorScale, maxVal) {
    const steps = 7;
    const swatches = Array.from({ length: steps }, (_, i) => {
      const val = (maxVal / (steps - 1)) * i;
      return `<span class="legend-swatch-box" style="background:${colorScale(val)};display:inline-block;width:28px;height:12px;border-radius:3px;"></span>`;
    }).join("");
    legendEl.innerHTML = `
      <div class="legend-title">${state.mode === "destination" ? "Immigrants received" : "Emigrants sent"} — ${state.year}</div>
      <div style="display:flex;gap:2px;margin:4px 0;">${swatches}</div>
      <div style="display:flex;justify-content:space-between;font-size:0.78rem;color:#5b5f67;">
        <span>0</span><span>${approxFormat(maxVal / 2)}</span><span>${approxFormat(maxVal)}+</span>
      </div>
    `;
  }

  function renderMap() {
    if (!apiData || !geoFeatures) return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const projection = d3.geoNaturalEarth1().scale(153).translate([480, 250]);
    const path = d3.geoPath().projection(projection);

    // Compute 98th percentile as max for color scale
    const allVals = Object.keys(lookup).map((c) => getVal(c)).filter((v) => v > 0);
    allVals.sort(d3.ascending);
    const maxVal = d3.quantile(allVals, 0.97) || 1;

    const colorScale = d3
      .scaleSequential()
      .domain([0, maxVal])
      .interpolator(state.mode === "destination" ? d3.interpolateBlues : d3.interpolatePurples)
      .clamp(true);

    // Ocean background
    svg.append("path")
      .datum({ type: "Sphere" })
      .attr("d", path)
      .attr("fill", "#dbeafe");

    // Graticule
    svg.append("path")
      .datum(d3.geoGraticule()())
      .attr("d", path)
      .attr("fill", "none")
      .attr("stroke", "rgba(255,255,255,0.3)")
      .attr("stroke-width", 0.4);

    const tooltip = d3.select(tooltipEl);

    svg.append("g")
      .selectAll("path")
      .data(geoFeatures)
      .join("path")
      .attr("d", path)
      .attr("fill", (d) => {
        const geoName = d.properties?.name || "";
        const matched = matchName(geoName);
        if (!matched) return "#e2e8f0";
        const val = getVal(matched);
        return val > 0 ? colorScale(val) : "#e2e8f0";
      })
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.5)
      .on("mousemove", function (event, d) {
        const geoName = d.properties?.name || "Unknown";
        const matched = matchName(geoName);
        const val = matched ? getVal(matched) : 0;

        const label = state.mode === "destination" ? "Immigrants" : "Emigrants";
        const partnerKey = normalizeName(matched || geoName);
        const partnersData = topPartnersLookup[partnerKey]?.[state.year];
        const partnerList = partnersData
          ? (state.mode === "destination" ? partnersData.inflow : partnersData.outflow)
          : [];

        let partnersHtml = "";
        if (partnerList && partnerList.length > 0) {
          const partnerLabel = state.mode === "destination" ? "Top origins" : "Top destinations";
          partnersHtml =
            `<div style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.2);padding-top:5px;">` +
            `<div style="font-size:0.78rem;color:rgba(255,255,255,0.65);margin-bottom:3px;">${partnerLabel}:</div>` +
            partnerList.map((p, i) =>
              `<div style="display:flex;justify-content:space-between;gap:12px;font-size:0.82rem;">` +
              `<span>${i + 1}. ${p.country}</span><span style="color:#86efac;">${approxFormat(p.value)}</span></div>`
            ).join("") +
            `</div>`;
        }

        tooltip
          .style("opacity", 1)
          .html(
            `<strong>${geoName}</strong><br>` +
            (val > 0 ? `${label}: <strong>${approxFormat(val)}</strong>` : `No data`) +
            partnersHtml
          )
          .style("left", `${event.clientX + 14}px`)
          .style("top", `${event.clientY + 14}px`);
        d3.select(this).raise().attr("stroke", "#1f2937").attr("stroke-width", 1.5);
      })
      .on("mouseleave", function () {
        tooltip.style("opacity", 0);
        d3.select(this).attr("stroke", "#fff").attr("stroke-width", 0.5);
      });

    renderLegend(colorScale, maxVal);

    mapModeLabelEl.textContent = state.mode === "destination" ? "Destination Density" : "Origin Density";
    mapSubtitleEl.textContent =
      state.mode === "destination"
        ? "Countries colored by immigrants received"
        : "Countries colored by emigrants sent";
    yearDisplayEl.textContent = state.year;
    genderDisplayEl.textContent =
      state.gender === "total" ? "All genders" : state.gender === "males" ? "Male" : "Female";

    const topCountries = Object.keys(lookup)
      .map((c) => ({ country: c, val: getVal(c) }))
      .filter((c) => c.val > 0)
      .sort((a, b) => b.val - a.val)
      .slice(0, 3);
    vizSummary.textContent =
      topCountries.length
        ? `Top: ${topCountries.map((c) => `${c.country} (${approxFormat(c.val)})`).join(", ")}`
        : "No data";
  }

  async function init() {
    try {
      vizSummary.textContent = "Loading…";
      const [apiResp, topoResp] = await Promise.all([
        fetch(endpoint),
        fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"),
      ]);
      if (!apiResp.ok) throw new Error(`API ${apiResp.status}`);
      if (!topoResp.ok) throw new Error(`TopoJSON ${topoResp.status}`);

      apiData = await apiResp.json();
      const topoData = await topoResp.json();

      // Patch country names using a names lookup CDN
      const namesResp = await fetch(
        "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json"
      );
      // world-atlas 110m doesn't have names — use a separate names file
      const namesPatch = await fetch(
        "https://cdn.jsdelivr.net/gh/mledoze/countries@master/countries.json"
      ).catch(() => null);

      if (namesPatch && namesPatch.ok) {
        const countriesJson = await namesPatch.json();
        const numericToName = {};
        countriesJson.forEach((c) => {
          if (c.ccn3 && c.name?.common) {
            numericToName[parseInt(c.ccn3, 10)] = c.name.common;
          }
        });
        topoData.objects.countries.geometries.forEach((g) => {
          if (!g.properties) g.properties = {};
          g.properties.name = numericToName[g.id] || g.properties.name || String(g.id);
        });
      }

      geoFeatures = topojson.feature(topoData, topoData.objects.countries).features;

      buildLookup();

      yearSlider.max = String(apiData.years.length - 1);
      yearSlider.value = String(apiData.years.length - 1);

      renderMap();
    } catch (err) {
      vizSummary.textContent = "Failed to load map data.";
      console.error(err);
    }
  }

  document.querySelectorAll(".mode-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mode-chip").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.mode = btn.dataset.mode;
      renderMap();
    });
  });

  document.querySelectorAll(".gender-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".gender-chip").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.gender = btn.dataset.gender;
      renderMap();
    });
  });

  yearSlider.addEventListener("input", (event) => {
    if (!apiData) return;
    state.year = apiData.years[Number(event.target.value)];
    yearChip.textContent = state.year;
    renderMap();
  });

  init();
})();
