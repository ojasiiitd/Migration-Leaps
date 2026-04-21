(function () {
  const root = document.getElementById("chord-app");
  if (!root) return;

  const endpoint = root.dataset.endpoint;
  const svgEl = document.getElementById("chord-chart");
  const tooltipEl = document.getElementById("tooltip");
  const yearSlider = document.getElementById("year-slider");
  const yearChip = document.getElementById("year-chip");
  const topnSlider = document.getElementById("topn-slider");
  const topnChip = document.getElementById("topn-chip");
  const vizSummary = document.getElementById("viz-summary");
  const yearDisplayEl = document.getElementById("year-display");
  const topnDisplayEl = document.getElementById("topn-display");

  let apiData = null;
  let state = { year: "2024", topN: 20 };
  let hoveredCountry = null;

  const CONTINENT_COLOR = {
    "Africa": "#f59e0b",
    "Asia": "#6366f1",
    "Europe": "#0ea5e9",
    "North America": "#10b981",
    "South America": "#f43f5e",
    "Oceania": "#a855f7",
  };
  const DEFAULT_COLOR = "#9ca3af";

  function countryColor(name) {
    const c = apiData.country_to_continent[name];
    return c ? CONTINENT_COLOR[c] : DEFAULT_COLOR;
  }

  function fmt(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toString();
  }

  function getTopCorridors() {
    const corridors = apiData.corridors_by_year[state.year] || [];
    return [...corridors]
      .sort((a, b) => b.value - a.value)
      .slice(0, state.topN);
  }

  function renderChart() {
    if (!apiData) return;

    const topCorridors = getTopCorridors();
    if (!topCorridors.length) {
      d3.select(svgEl).selectAll("*").remove();
      vizSummary.textContent = "No data.";
      return;
    }

    // Collect unique countries from top corridors
    const countrySet = new Set();
    topCorridors.forEach((c) => {
      countrySet.add(c.source);
      countrySet.add(c.target);
    });
    const countries = Array.from(countrySet);
    const n = countries.length;
    const indexMap = new Map(countries.map((c, i) => [c, i]));

    // Build n×n matrix (directed: flow from i to j)
    const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
    topCorridors.forEach((c) => {
      const i = indexMap.get(c.source);
      const j = indexMap.get(c.target);
      if (i !== undefined && j !== undefined) {
        matrix[i][j] += c.value;
      }
    });

    // D3 chord layout
    const chord = d3.chord()
      .padAngle(0.04)
      .sortSubgroups(d3.descending)
      .sortChords(d3.descending);

    const chords = chord(matrix);

    const R_OUTER = 460;
    const R_INNER = 400;

    const arc = d3.arc()
      .innerRadius(R_INNER)
      .outerRadius(R_OUTER);

    const ribbon = d3.ribbon().radius(R_INNER - 2);

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    const tooltip = d3.select(tooltipEl);

    // Groups (country arcs)
    const groupG = svg.append("g")
      .selectAll("g")
      .data(chords.groups)
      .join("g");

    groupG.append("path")
      .attr("d", arc)
      .attr("fill", (d) => countryColor(countries[d.index]))
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .attr("opacity", 0.9)
      .style("cursor", "pointer")
      .on("mouseover", (event, d) => {
        hoveredCountry = countries[d.index];
        applyHighlights();

        const name = countries[d.index];
        const outTotal = topCorridors
          .filter((c) => c.source === name)
          .reduce((s, c) => s + c.value, 0);
        const inTotal = topCorridors
          .filter((c) => c.target === name)
          .reduce((s, c) => s + c.value, 0);

        tooltip
          .style("opacity", 1)
          .html(
            `<strong>${name}</strong><br>` +
            `Outflow: ${fmt(outTotal)}<br>` +
            `Inflow: ${fmt(inTotal)}`
          )
          .style("left", `${event.clientX + 14}px`)
          .style("top", `${event.clientY + 14}px`);
      })
      .on("mouseleave", () => {
        hoveredCountry = null;
        applyHighlights();
        tooltip.style("opacity", 0);
      });

    // Country labels
    groupG.append("text")
      .each((d) => { d.angle = (d.startAngle + d.endAngle) / 2; })
      .attr("dy", "0.35em")
      .attr("transform", (d) => {
        const angle = (d.startAngle + d.endAngle) / 2;
        const rotate = (angle * 180) / Math.PI - 90;
        const flip = angle > Math.PI ? "rotate(180)" : "";
        return `rotate(${rotate}) translate(${R_OUTER + 8},0) ${flip}`;
      })
      .attr("text-anchor", (d) => {
        const angle = (d.startAngle + d.endAngle) / 2;
        return angle > Math.PI ? "end" : "start";
      })
      .attr("font-size", "12px")
      .attr("font-family", "Georgia,serif")
      .attr("fill", "#1f2937")
      .text((d) => countries[d.index])
      .style("pointer-events", "none");

    // Ribbons (flows)
    const ribbonG = svg.append("g")
      .attr("fill-opacity", 0.7);

    ribbonG.selectAll("path")
      .data(chords)
      .join("path")
      .attr("class", "chord-ribbon")
      .attr("d", ribbon)
      .attr("fill", (d) => countryColor(countries[d.source.index]))
      .attr("stroke", (d) => d3.color(countryColor(countries[d.source.index])).darker(0.5))
      .attr("stroke-width", 0.5)
      .attr("opacity", 0.65)
      .style("cursor", "pointer")
      .on("mouseover", (event, d) => {
        const src = countries[d.source.index];
        const tgt = countries[d.target.index];
        const srcToTgt = matrix[d.source.index][d.target.index];
        const tgtToSrc = matrix[d.target.index][d.source.index];

        // Find rank
        const allSorted = [...topCorridors].sort((a, b) => b.value - a.value);
        const rank = allSorted.findIndex(
          (c) => (c.source === src && c.target === tgt) ||
                 (c.source === tgt && c.target === src)
        ) + 1;

        tooltip
          .style("opacity", 1)
          .html(
            `<strong>${src} → ${tgt}</strong><br>` +
            (srcToTgt ? `${src} → ${tgt}: ${fmt(srcToTgt)}<br>` : "") +
            (tgtToSrc ? `${tgt} → ${src}: ${fmt(tgtToSrc)}<br>` : "") +
            (rank ? `Rank: #${rank}` : "")
          )
          .style("left", `${event.clientX + 14}px`)
          .style("top", `${event.clientY + 14}px`);

        d3.selectAll(".chord-ribbon").attr("opacity", 0.12);
        d3.select(event.currentTarget).attr("opacity", 0.9);
      })
      .on("mouseleave", () => {
        tooltip.style("opacity", 0);
        hoveredCountry = null;
        applyHighlights();
      });

    // Legend — placed bottom-centre, two columns, larger text
    const presentContinents = new Set(
      countries.map((c) => apiData.country_to_continent[c]).filter(Boolean)
    );
    const legendData = Object.entries(CONTINENT_COLOR).filter(([k]) => presentContinents.has(k));
    const legRowH = 26, legSwatchW = 18, legColW = 200;
    const legCols = 3;
    const legRows = Math.ceil(legendData.length / legCols);
    const legW = legCols * legColW;
    const legH = legRows * legRowH + 24; // 24 for title
    const legX = -legW / 2;
    const legY = R_OUTER + 20;

    const legendG = svg.append("g").attr("transform", `translate(${legX},${legY})`);
    legendG.append("text")
      .attr("x", 0).attr("y", 16)
      .attr("font-size", "13px").attr("font-weight", "bold")
      .attr("fill", "#5b5f67").attr("font-family", "Georgia,serif")
      .text("Region");
    legendData.forEach(([continent, color], i) => {
      const col = i % legCols, row = Math.floor(i / legCols);
      const lx = col * legColW, ly = 24 + row * legRowH;
      legendG.append("rect")
        .attr("x", lx).attr("y", ly)
        .attr("width", legSwatchW).attr("height", legSwatchW)
        .attr("fill", color).attr("rx", 4);
      legendG.append("text")
        .attr("x", lx + legSwatchW + 8).attr("y", ly + 13)
        .attr("font-size", "13px").attr("fill", "#1f2937")
        .attr("font-family", "Georgia,serif").text(continent);
    });

    vizSummary.textContent = `${topCorridors.length} corridors, ${countries.length} countries`;
    yearDisplayEl.textContent = state.year;
    topnDisplayEl.textContent = `Top ${state.topN} corridors`;

    function applyHighlights() {
      if (!hoveredCountry) {
        groupG.selectAll("path").attr("opacity", 0.9);
        ribbonG.selectAll(".chord-ribbon").attr("opacity", 0.65);
        return;
      }
      const hi = indexMap.get(hoveredCountry);
      groupG.selectAll("path").attr("opacity", (d) => d.index === hi ? 1 : 0.3);
      ribbonG.selectAll(".chord-ribbon").attr("opacity", (d) =>
        d.source.index === hi || d.target.index === hi ? 0.9 : 0.08
      );
    }
  }

  async function init() {
    try {
      const resp = await fetch(endpoint);
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      apiData = await resp.json();

      yearSlider.max = String(apiData.years.length - 1);
      yearSlider.value = String(apiData.years.length - 1);

      renderChart();
    } catch (err) {
      vizSummary.textContent = "Failed to load data.";
      console.error(err);
    }
  }

  yearSlider.addEventListener("input", (e) => {
    if (!apiData) return;
    state.year = apiData.years[Number(e.target.value)];
    yearChip.textContent = state.year;
    renderChart();
  });

  topnSlider.addEventListener("input", (e) => {
    state.topN = Number(e.target.value);
    topnChip.textContent = state.topN;
    renderChart();
  });

  init();
})();
