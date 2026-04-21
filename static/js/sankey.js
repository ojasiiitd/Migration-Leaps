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

  function approxFormat(n) {
    if (n >= 10_000_000) return `~${(n / 10_000_000).toFixed(1)} Cr`;
    if (n >= 100_000) return `~${(n / 100_000).toFixed(1)} L`;
    return `~${n.toLocaleString("en-IN")}`;
  }

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

  function getCountriesForContinent(continent) {
    return data.continent_countries[continent].filter((c) => {
      const meta = data.country_meta[c];
      if (!meta.cross_continent) return true;
      // cross-continent countries: include only if toggled in
      return state.crossContinentEnabled.has(c);
    });
  }

  function setContinentSelection(side, continent) {
    if (side === "origin") {
      state.originContinent = continent;
      state.selectedOrigins = new Set(getCountriesForContinent(continent));
    } else {
      state.destinationContinent = continent;
      state.selectedDestinations = new Set(getCountriesForContinent(continent));
    }
  }

  function renderChipGroup(container, countries, selectedSet, side) {
    container.innerHTML = "";
    const continent = side === "origin" ? state.originContinent : state.destinationContinent;
    const allForContinent = data.continent_countries[continent];

    allForContinent.forEach((country) => {
      const meta = data.country_meta[country];
      const isCross = meta.cross_continent;
      const button = document.createElement("button");
      button.type = "button";

      const isEnabled = isCross ? state.crossContinentEnabled.has(country) : true;
      const isSelected = selectedSet.has(country);

      button.className = "country-chip" + (isSelected && isEnabled ? " active" : "");

      if (isCross) {
        button.className += " cross-continent-chip";
        button.title = `${displayName(country)} spans multiple continents (${meta.continents.join(" & ")}). Click to toggle inclusion.`;
      }

      button.textContent = displayName(country);
      if (isCross) {
        button.textContent += " ↔";
      }

      button.addEventListener("click", () => {
        if (isCross) {
          // Toggle cross-continent membership for this continent
          if (state.crossContinentEnabled.has(country)) {
            state.crossContinentEnabled.delete(country);
            selectedSet.delete(country);
          } else {
            state.crossContinentEnabled.add(country);
            selectedSet.add(country);
          }
        } else {
          if (selectedSet.has(country) && selectedSet.size > 1) {
            selectedSet.delete(country);
          } else if (!selectedSet.has(country)) {
            selectedSet.add(country);
          }
        }
        renderControls();
        renderChart();
      });
      container.appendChild(button);
    });
  }

  function renderControls() {
    const continents = Object.keys(data.continent_countries);
    populateSelect(originSelect, continents, state.originContinent);
    populateSelect(destinationSelect, continents, state.destinationContinent);

    yearChip.textContent = state.year;
    originTitle.textContent = `${state.originContinent} Origins`;
    destinationTitle.textContent = `${state.destinationContinent} Destinations`;
    originLabel.textContent = state.originContinent;
    destinationLabel.textContent = state.destinationContinent;

    renderChipGroup(originChips, data.continent_countries[state.originContinent], state.selectedOrigins, "origin");
    renderChipGroup(destinationChips, data.continent_countries[state.destinationContinent], state.selectedDestinations, "destination");
  }

  function getCorridorValue(row) {
    if (state.gender === "males") return row.values_males?.[state.year] || 0;
    if (state.gender === "females") return row.values_females?.[state.year] || 0;
    return row.values[state.year] || 0;
  }

  function filteredCorridors() {
    return data.corridors
      .filter((row) => row.origin_continents.includes(state.originContinent))
      .filter((row) => row.destination_continents.includes(state.destinationContinent))
      .filter((row) => state.selectedOrigins.has(row.source))
      .filter((row) => state.selectedDestinations.has(row.target))
      .map((row) => ({ ...row, value: getCorridorValue(row) }))
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

    const palette = d3.schemeTableau10;
    const countryColorMap = new Map(
      graph.nodes
        .filter((d) => d.side === "origin")
        .map((d, i) => [d.country, palette[i % palette.length]])
    );

    vizSummary.textContent = `${rows.length} links shown, ${approxFormat(totalFlow)} migrants in ${state.year}.`;
    svg.selectAll("*").remove();

    svg
      .append("g")
      .selectAll("path")
      .data(graph.links)
      .join("path")
      .attr("class", "link")
      .attr("d", d3.sankeyLinkHorizontal())
      .attr("stroke", (d) => countryColorMap.get(d.source.country))
      .attr("stroke-width", (d) => Math.max(1, d.width))
      .on("mousemove", (event, d) => {
        tooltip
          .style("opacity", 1)
          .html(
            `<strong>${displayName(d.source.country)}</strong> → <strong>${displayName(d.target.country)}</strong><br>${approxFormat(d.value)} migrants in ${state.year}`,
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
      .filter((d) => d.side === "origin")
      .append("rect")
      .attr("x", (d) => d.x0)
      .attr("y", (d) => d.y0)
      .attr("width", (d) => d.x1 - d.x0)
      .attr("height", (d) => Math.max(1, d.y1 - d.y0))
      .attr("fill", (d) => countryColorMap.get(d.country))
      .on("mousemove", (event, d) => {
        tooltip
          .style("opacity", 1)
          .html(`<strong>${d.label}</strong><br>${approxFormat(d.value)} total shown in ${state.year}`)
          .style("left", `${event.clientX}px`)
          .style("top", `${event.clientY}px`);
      })
      .on("mouseleave", () => {
        tooltip.style("opacity", 0);
      });

    node
      .filter((d) => d.side === "destination")
      .each(function (d) {
        const g = d3.select(this);
        const nodeWidth = d.x1 - d.x0;

        d.targetLinks.forEach((link) => {
          g.append("rect")
            .attr("x", d.x0)
            .attr("y", link.y1 - link.width / 2)
            .attr("width", nodeWidth)
            .attr("height", Math.max(1, link.width))
            .attr("fill", countryColorMap.get(link.source.country));
        });

        g.append("rect")
          .attr("x", d.x0)
          .attr("y", d.y0)
          .attr("width", nodeWidth)
          .attr("height", Math.max(1, d.y1 - d.y0))
          .attr("fill", "transparent")
          .on("mousemove", (event) => {
            tooltip
              .style("opacity", 1)
              .html(`<strong>${d.label}</strong><br>${approxFormat(d.value)} total shown in ${state.year}`)
              .style("left", `${event.clientX}px`)
              .style("top", `${event.clientY}px`);
          })
          .on("mouseleave", () => {
            tooltip.style("opacity", 0);
          });
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
      .text((d) => approxFormat(d.value));
  }

  async function init() {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`);
      }

      data = await response.json();

      // Cross-continent countries start toggled OFF by default
      state = {
        originContinent: "Asia",
        destinationContinent: "North America",
        year: data.years[data.years.length - 1],
        gender: "total",
        crossContinentEnabled: new Set(),
        selectedOrigins: new Set(),
        selectedDestinations: new Set(),
      };

      // Populate initial selections (excluding cross-continent by default)
      state.selectedOrigins = new Set(
        data.continent_countries["Asia"].filter((c) => !data.country_meta[c].cross_continent)
      );
      state.selectedDestinations = new Set(
        data.continent_countries["North America"].filter((c) => !data.country_meta[c].cross_continent)
      );

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

  document.querySelectorAll(".gender-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".gender-chip").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.gender = btn.dataset.gender;
      renderChart();
    });
  });

  init();
})();
