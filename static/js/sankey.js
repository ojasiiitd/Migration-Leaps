(function () {
  const root = document.getElementById("sankey-app");
  if (!root) {
    return;
  }

  const endpoint = root.dataset.endpoint;
  const chartEl = document.getElementById("chart");
  const tooltipEl = document.getElementById("tooltip");
  const originSelect = document.getElementById("origin-continent");
  const destinationSelect = document.getElementById("destination-continent");
  const yearSlider = document.getElementById("year-slider");
  const yearChip = document.getElementById("year-chip");
  const originChips = document.getElementById("origin-chips");
  const destinationChips = document.getElementById("destination-chips");
  const originTitle = document.getElementById("origin-title");
  const destinationTitle = document.getElementById("destination-title");
  const originLabel = document.getElementById("origin-label");
  const destinationLabel = document.getElementById("destination-label");
  const vizSummary = document.getElementById("viz-summary");

  const width = 1320;
  const height = 820;
  const marginTop = 16;
  const marginRight = 220;
  const marginBottom = 18;
  const marginLeft = 220;
  const topLinks = 20;
  const numberFormat = new Intl.NumberFormat("en-US");

  const continentColors = {
    Africa: "#b45309",
    Asia: "#2563eb",
    Europe: "#7c3aed",
    "North America": "#0f766e",
    "South America": "#dc2626",
    Oceania: "#0891b2",
  };

  let data = null;
  let state = null;

  function showEmptyState(message) {
    chartEl.innerHTML = `
      <foreignObject x="0" y="180" width="${width}" height="260">
        <div xmlns="http://www.w3.org/1999/xhtml" class="empty-state">${message}</div>
      </foreignObject>
    `;
  }

  function displayName(country) {
    return data.country_meta[country].label;
  }

  function d3Ready() {
    return typeof window.d3 !== "undefined" && typeof window.d3.sankey === "function";
  }

  function populateSelect(selectNode, options, selectedValue) {
    selectNode.innerHTML = "";
    options.forEach((optionValue) => {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionValue;
      option.selected = optionValue === selectedValue;
      selectNode.appendChild(option);
    });
  }

  function setContinentSelection(side, continent) {
    if (side === "origin") {
      state.originContinent = continent;
      state.selectedOrigins = new Set(data.continent_countries[continent]);
    } else {
      state.destinationContinent = continent;
      state.selectedDestinations = new Set(data.continent_countries[continent]);
    }
  }

  function renderChipGroup(container, countries, selectedSet) {
    container.innerHTML = "";
    countries.forEach((country) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "country-chip" + (selectedSet.has(country) ? " active" : "");
      button.textContent = displayName(country);
      button.addEventListener("click", () => {
        if (selectedSet.has(country) && selectedSet.size > 1) {
          selectedSet.delete(country);
        } else if (!selectedSet.has(country)) {
          selectedSet.add(country);
        }
        renderControls();
        renderChart();
      });
      container.appendChild(button);
    });
  }

  function renderControls() {
    const continents = Object.keys(data.continent_countries);
    const originCountries = data.continent_countries[state.originContinent];
    const destinationCountries = data.continent_countries[state.destinationContinent];

    populateSelect(originSelect, continents, state.originContinent);
    populateSelect(destinationSelect, continents, state.destinationContinent);

    yearChip.textContent = state.year;
    originTitle.textContent = `${state.originContinent} Origins`;
    destinationTitle.textContent = `${state.destinationContinent} Destinations`;
    originLabel.textContent = state.originContinent;
    destinationLabel.textContent = state.destinationContinent;

    renderChipGroup(originChips, originCountries, state.selectedOrigins);
    renderChipGroup(destinationChips, destinationCountries, state.selectedDestinations);
  }

  function filteredCorridors() {
    return data.corridors
      .filter((row) => row.origin_continent === state.originContinent)
      .filter((row) => row.destination_continent === state.destinationContinent)
      .filter((row) => state.selectedOrigins.has(row.source))
      .filter((row) => state.selectedDestinations.has(row.target))
      .map((row) => ({
        ...row,
        value: row.values[state.year] || 0,
      }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, topLinks);
  }

  function buildSankeyGraph(rows) {
    const sourceOrder = new Map(
      data.continent_countries[state.originContinent].map((country, index) => [country, index]),
    );
    const targetOrder = new Map(
      data.continent_countries[state.destinationContinent].map((country, index) => [country, index]),
    );

    const nodes = [
      ...Array.from(state.selectedOrigins).map((country) => ({
        id: `origin:${country}`,
        label: displayName(country),
        country,
        side: "origin",
      })),
      ...Array.from(state.selectedDestinations).map((country) => ({
        id: `destination:${country}`,
        label: displayName(country),
        country,
        side: "destination",
      })),
    ];

    const links = rows.map((row) => ({
      source: `origin:${row.source}`,
      target: `destination:${row.target}`,
      value: row.value,
    }));

    const sankey = d3
      .sankey()
      .nodeId((d) => d.id)
      .nodeWidth(18)
      .nodePadding(18)
      .nodeSort((a, b) => {
        const orderMap = a.side === "origin" ? sourceOrder : targetOrder;
        return d3.ascending(orderMap.get(a.country), orderMap.get(b.country));
      })
      .extent([
        [marginLeft, marginTop],
        [width - marginRight, height - marginBottom],
      ]);

    return sankey({
      nodes: nodes.map((d) => ({ ...d })),
      links: links.map((d) => ({ ...d })),
    });
  }

  function renderChart() {
    if (!d3Ready()) {
      vizSummary.textContent = "D3 failed to load in this environment.";
      showEmptyState("D3 library not available.");
      return;
    }

    const rows = filteredCorridors();
    if (!rows.length) {
      vizSummary.textContent = `No non-zero corridors for ${state.originContinent} to ${state.destinationContinent} in ${state.year}.`;
      showEmptyState("No migration corridors match the current filters for this year.");
      return;
    }

    const svg = d3.select(chartEl);
    const tooltip = d3.select(tooltipEl);
    const totalFlow = rows.reduce((sum, row) => sum + row.value, 0);
    const graph = buildSankeyGraph(rows);

    vizSummary.textContent = `${rows.length} links shown, ${numberFormat.format(totalFlow)} migrants in ${state.year}.`;
    svg.selectAll("*").remove();

    svg
      .append("g")
      .selectAll("path")
      .data(graph.links)
      .join("path")
      .attr("class", "link")
      .attr("d", d3.sankeyLinkHorizontal())
      .attr("stroke", continentColors[state.originContinent])
      .attr("stroke-width", (d) => Math.max(1, d.width))
      .on("mousemove", (event, d) => {
        tooltip
          .style("opacity", 1)
          .html(
            `<strong>${displayName(d.source.country)}</strong> → <strong>${displayName(d.target.country)}</strong><br>${numberFormat.format(d.value)} migrants in ${state.year}`,
          )
          .style("left", `${event.clientX}px`)
          .style("top", `${event.clientY}px`);
      })
      .on("mouseleave", () => {
        tooltip.style("opacity", 0);
      });

    const node = svg
      .append("g")
      .selectAll("g")
      .data(graph.nodes)
      .join("g")
      .attr("class", "node");

    node
      .append("rect")
      .attr("x", (d) => d.x0)
      .attr("y", (d) => d.y0)
      .attr("width", (d) => d.x1 - d.x0)
      .attr("height", (d) => Math.max(1, d.y1 - d.y0))
      .attr(
        "fill",
        (d) => continentColors[d.side === "origin" ? state.originContinent : state.destinationContinent],
      )
      .on("mousemove", (event, d) => {
        tooltip
          .style("opacity", 1)
          .html(`<strong>${d.label}</strong><br>${numberFormat.format(d.value)} total shown in ${state.year}`)
          .style("left", `${event.clientX}px`)
          .style("top", `${event.clientY}px`);
      })
      .on("mouseleave", () => {
        tooltip.style("opacity", 0);
      });

    node
      .append("text")
      .attr("class", "node-label")
      .attr("x", (d) => (d.side === "origin" ? d.x0 - 12 : d.x1 + 12))
      .attr("y", (d) => (d.y0 + d.y1) / 2 - 4)
      .attr("text-anchor", (d) => (d.side === "origin" ? "end" : "start"))
      .text((d) => d.label);

    node
      .append("text")
      .attr("class", "node-value")
      .attr("x", (d) => (d.side === "origin" ? d.x0 - 12 : d.x1 + 12))
      .attr("y", (d) => (d.y0 + d.y1) / 2 + 14)
      .attr("text-anchor", (d) => (d.side === "origin" ? "end" : "start"))
      .text((d) => numberFormat.format(d.value));
  }

  async function init() {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`);
      }

      data = await response.json();
      state = {
        originContinent: "Asia",
        destinationContinent: "North America",
        year: data.years[data.years.length - 1],
        selectedOrigins: new Set(data.continent_countries["Asia"]),
        selectedDestinations: new Set(data.continent_countries["North America"]),
      };

      yearSlider.max = String(data.years.length - 1);
      yearSlider.value = String(data.years.length - 1);

      renderControls();
      renderChart();
    } catch (error) {
      vizSummary.textContent = "Sankey data could not be loaded.";
      showEmptyState("Failed to load migration data for this view.");
      console.error(error);
    }
  }

  originSelect.addEventListener("change", (event) => {
    setContinentSelection("origin", event.target.value);
    renderControls();
    renderChart();
  });

  destinationSelect.addEventListener("change", (event) => {
    setContinentSelection("destination", event.target.value);
    renderControls();
    renderChart();
  });

  yearSlider.addEventListener("input", (event) => {
    state.year = data.years[Number(event.target.value)];
    renderControls();
    renderChart();
  });

  init();
})();
