(function () {
  const root = document.getElementById("netflow-app");
  if (!root) return;

  const endpoint = root.dataset.endpoint;
  const svgEl = document.getElementById("netflow-chart");
  const tooltipEl = document.getElementById("tooltip");
  const yearSlider = document.getElementById("year-slider");
  const yearChip = document.getElementById("year-chip");
  const vizSummary = document.getElementById("viz-summary");
  const yearDisplayEl = document.getElementById("year-display");
  const regionDisplayEl = document.getElementById("region-display");
  const regionSelect = document.getElementById("region-select");

  let apiData = null;
  let state = {
    year: "2024",
    sort: "magnitude",
    region: "all",
  };

  const TOP_N = 30;
  const COLOR_GAIN = "#059669";
  const COLOR_LOSS = "#dc2626";

  function approxFormat(n) {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toString();
  }

  function getFilteredRecords() {
    const filtered = apiData.records.filter(
      (r) =>
        r.year === state.year &&
        (state.region === "all" || r.region === state.region)
    );
    // Deduplicate by country name (cross-continent countries appear multiple times)
    const seen = new Map();
    filtered.forEach((r) => {
      if (!seen.has(r.country)) seen.set(r.country, r);
    });
    return Array.from(seen.values());
  }

  function getSortedBars() {
    const records = getFilteredRecords();

    if (state.sort === "gainers") {
      return records
        .filter((r) => r.net > 0)
        .sort((a, b) => b.net - a.net)
        .slice(0, TOP_N);
    }
    if (state.sort === "losers") {
      return records
        .filter((r) => r.net < 0)
        .sort((a, b) => a.net - b.net)
        .slice(0, TOP_N);
    }
    // magnitude: mix gainers and losers by absolute value
    const sorted = records.sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, TOP_N);
    return sorted.sort((a, b) => b.net - a.net);
  }

  function renderChart() {
    if (!apiData) return;

    const bars = getSortedBars();
    if (!bars.length) {
      d3.select(svgEl).selectAll("*").remove();
      vizSummary.textContent = "No data for current filters.";
      return;
    }

    const vw = 1200;
    const vh = 620;
    const marginLeft = 180;
    const marginRight = 40;
    const marginTop = 30;
    const marginBottom = 50;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const tooltip = d3.select(tooltipEl);

    const xExtent = d3.extent(bars, (d) => d.net);
    // Ensure 0 is always in domain
    const xDomain = [Math.min(0, xExtent[0]), Math.max(0, xExtent[1])];

    const xScale = d3
      .scaleLinear()
      .domain(xDomain)
      .range([marginLeft, vw - marginRight])
      .nice();

    const yScale = d3
      .scaleBand()
      .domain(bars.map((d) => d.country))
      .range([marginTop, vh - marginBottom])
      .padding(0.22);

    const xZero = xScale(0);

    // Gridlines
    svg.append("g")
      .attr("class", "grid")
      .attr("transform", `translate(0,${marginTop})`)
      .call(
        d3.axisTop(xScale)
          .ticks(8)
          .tickSize(vh - marginTop - marginBottom)
          .tickFormat("")
      )
      .call((g) => {
        g.select(".domain").remove();
        g.selectAll("line").attr("stroke", "rgba(31,41,55,0.07)");
      });

    // Zero line
    svg.append("line")
      .attr("x1", xZero)
      .attr("x2", xZero)
      .attr("y1", marginTop)
      .attr("y2", vh - marginBottom)
      .attr("stroke", "rgba(31,41,55,0.35)")
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "4,3");

    // X axis
    svg.append("g")
      .attr("transform", `translate(0,${marginTop})`)
      .call(d3.axisTop(xScale).ticks(8).tickFormat((d) => approxFormat(d)))
      .call((g) => {
        g.select(".domain").remove();
        g.selectAll("text").attr("fill", "#5b5f67").attr("font-size", "11px");
        g.selectAll("line").attr("stroke", "transparent");
      });

    // Bars
    svg.append("g")
      .selectAll("rect")
      .data(bars)
      .join("rect")
      .attr("x", (d) => d.net >= 0 ? xZero : xScale(d.net))
      .attr("y", (d) => yScale(d.country))
      .attr("width", (d) => Math.abs(xScale(d.net) - xZero))
      .attr("height", yScale.bandwidth())
      .attr("fill", (d) => d.net >= 0 ? COLOR_GAIN : COLOR_LOSS)
      .attr("rx", 3)
      .attr("opacity", 0.85)
      .on("mousemove", (event, d) => {
        tooltip
          .style("opacity", 1)
          .html(
            `<strong>${d.country}</strong> (${d.year})<br>` +
            `Net: <strong>${approxFormat(d.net)}</strong><br>` +
            `Inflow: ${approxFormat(d.inflow)} &nbsp; Outflow: ${approxFormat(d.outflow)}`
          )
          .style("left", `${event.clientX + 14}px`)
          .style("top", `${event.clientY + 14}px`);
      })
      .on("mouseleave", () => tooltip.style("opacity", 0));

    // Value labels
    svg.append("g")
      .selectAll("text")
      .data(bars)
      .join("text")
      .attr("x", (d) => d.net >= 0 ? xScale(d.net) + 5 : xScale(d.net) - 5)
      .attr("y", (d) => yScale(d.country) + yScale.bandwidth() / 2 + 4)
      .attr("text-anchor", (d) => d.net >= 0 ? "start" : "end")
      .attr("fill", (d) => d.net >= 0 ? "#065f46" : "#991b1b")
      .attr("font-size", "10px")
      .attr("font-family", "Georgia, serif")
      .text((d) => approxFormat(d.net));

    // Y axis (country labels)
    svg.append("g")
      .attr("transform", `translate(${xZero},0)`)
      .call(d3.axisLeft(yScale).tickSize(0))
      .call((g) => {
        g.select(".domain").remove();
        g.selectAll("text")
          .attr("fill", "#1f2937")
          .attr("font-size", "11px")
          .attr("font-family", "Georgia, serif")
          .attr("dx", (d) => {
            const rec = bars.find((r) => r.country === d);
            return rec?.net >= 0 ? "-8" : "8";
          })
          .attr("text-anchor", (d) => {
            const rec = bars.find((r) => r.country === d);
            return rec?.net >= 0 ? "end" : "start";
          });
      });

    // Legend (bottom center, below chart)
    const legendG = svg.append("g").attr("transform", `translate(${vw / 2 - 80},${vh - marginBottom + 8})`);
    [[COLOR_GAIN, "Net gain (immigration)"], [COLOR_LOSS, "Net loss (emigration)"]].forEach(([color, label], i) => {
      legendG.append("rect").attr("x", i * 180).attr("y", 0).attr("width", 14).attr("height", 14).attr("fill", color).attr("rx", 3).attr("opacity", 0.85);
      legendG.append("text").attr("x", i * 180 + 20).attr("y", 11).attr("fill", "#1f2937").attr("font-size", "11px").attr("font-family", "Georgia, serif").text(label);
    });

    // Update summary
    const gainers = bars.filter((d) => d.net > 0).length;
    const losers = bars.filter((d) => d.net < 0).length;
    vizSummary.textContent = `Showing ${bars.length} countries — ${gainers} net gainers, ${losers} net losers`;
    yearDisplayEl.textContent = state.year;
    regionDisplayEl.textContent = state.region === "all" ? "All regions" : state.region;
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

  yearSlider.addEventListener("input", (event) => {
    if (!apiData) return;
    state.year = apiData.years[Number(event.target.value)];
    yearChip.textContent = state.year;
    renderChart();
  });

  document.querySelectorAll(".sort-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sort-chip").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.sort = btn.dataset.sort;
      renderChart();
    });
  });

  regionSelect.addEventListener("change", () => {
    state.region = regionSelect.value;
    renderChart();
  });

  init();
})();
