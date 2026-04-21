(function () {
  const root = document.getElementById("divbar-app");
  if (!root) return;

  const endpoint = root.dataset.endpoint;
  const svgEl = document.getElementById("divbar-chart");
  const tooltipEl = document.getElementById("tooltip");
  const yearSlider = document.getElementById("year-slider");
  const yearChip = document.getElementById("year-chip");
  const topnSlider = document.getElementById("topn-slider");
  const topnChip = document.getElementById("topn-chip");
  const vizSummary = document.getElementById("viz-summary");
  const yearDisplayEl = document.getElementById("year-display");
  const sortDisplayEl = document.getElementById("sort-display");

  const COLOR_MALE = "#3b82f6";
  const COLOR_FEMALE = "#f472b6";

  let apiData = null;
  let state = { year: "2024", sort: "total", topN: 30 };
  let lookup = null;

  function buildLookup() {
    lookup = {};
    for (const rec of apiData.records) {
      if (!lookup[rec.country]) lookup[rec.country] = {};
      lookup[rec.country][rec.year] = rec;
    }
  }

  function fmt(n) {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toString();
  }

  function pctDiff(d) {
    // (females - males) / total * 100, positive = more female
    if (d.total === 0) return 0;
    return ((d.females - d.males) / d.total * 100);
  }

  function getSortedData() {
    const recs = Object.keys(lookup)
      .filter((c) => lookup[c][state.year])
      .map((c) => lookup[c][state.year]);

    if (state.sort === "gap") {
      recs.sort((a, b) => Math.abs(pctDiff(b)) - Math.abs(pctDiff(a)));
    } else if (state.sort === "female_ratio") {
      recs.sort((a, b) => b.female_ratio - a.female_ratio);
    } else {
      recs.sort((a, b) => b.total - a.total);
    }
    return recs.slice(0, state.topN);
  }

  function renderChart() {
    if (!apiData || !lookup) return;

    const bars = getSortedData();
    if (!bars.length) { vizSummary.textContent = "No data."; return; }

    // Layout: fixed left margin for country names, generous height per bar
    const vw = 1200;
    const barH = 22;
    const pad = 6;
    const ml = 190, mr = 24, mt = 52, mb = 60;
    const chartH = bars.length * (barH + pad);
    const vh = mt + chartH + mb;

    // Update viewBox dynamically so labels never clip
    svgEl.setAttribute("viewBox", `0 0 ${vw} ${vh}`);

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    const tooltip = d3.select(tooltipEl);

    const maxVal = d3.max(bars, (d) => Math.max(d.males, d.females));
    const xScale = d3.scaleLinear()
      .domain([-maxVal, maxVal])
      .range([ml, vw - mr])
      .nice();

    const yScale = d3.scaleBand()
      .domain(bars.map((d) => d.country))
      .range([mt, mt + chartH])
      .padding(pad / (barH + pad));

    const xZero = xScale(0);

    // Gridlines
    svg.append("g")
      .attr("transform", `translate(0,${mt})`)
      .call(d3.axisTop(xScale).ticks(7).tickSize(chartH).tickFormat(""))
      .call((g) => { g.select(".domain").remove(); g.selectAll("line").attr("stroke", "rgba(31,41,55,0.07)"); });

    // Zero line
    svg.append("line")
      .attr("x1", xZero).attr("x2", xZero)
      .attr("y1", mt - 8).attr("y2", mt + chartH)
      .attr("stroke", "rgba(31,41,55,0.28)")
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "4,3");

    // X axis (top)
    svg.append("g")
      .attr("transform", `translate(0,${mt})`)
      .call(d3.axisTop(xScale).ticks(7).tickFormat((d) => fmt(Math.abs(d))))
      .call((g) => {
        g.select(".domain").remove();
        g.selectAll("text").attr("fill", "#5b5f67").attr("font-size", "13px").attr("font-family", "Georgia,serif");
        g.selectAll("line").attr("stroke", "transparent");
      });

    // Direction labels
    svg.append("text").attr("x", ml + 12).attr("y", mt - 28)
      .attr("fill", COLOR_MALE).attr("font-size", "13px").attr("font-family", "Georgia,serif")
      .attr("font-weight", "bold").text("← Male");
    svg.append("text").attr("x", vw - mr - 12).attr("y", mt - 28)
      .attr("text-anchor", "end")
      .attr("fill", COLOR_FEMALE).attr("font-size", "13px").attr("font-family", "Georgia,serif")
      .attr("font-weight", "bold").text("Female →");

    // Male bars
    svg.append("g").selectAll("rect")
      .data(bars).join("rect")
      .attr("x", (d) => xScale(-d.males))
      .attr("y", (d) => yScale(d.country))
      .attr("width", (d) => Math.max(0, xZero - xScale(-d.males)))
      .attr("height", yScale.bandwidth())
      .attr("fill", COLOR_MALE).attr("rx", 3).attr("opacity", 0.83)
      .on("mousemove", (ev, d) => showTip(ev, d))
      .on("mouseleave", () => tooltip.style("opacity", 0));

    // Female bars
    svg.append("g").selectAll("rect")
      .data(bars).join("rect")
      .attr("x", xZero)
      .attr("y", (d) => yScale(d.country))
      .attr("width", (d) => Math.max(0, xScale(d.females) - xZero))
      .attr("height", yScale.bandwidth())
      .attr("fill", COLOR_FEMALE).attr("rx", 3).attr("opacity", 0.83)
      .on("mousemove", (ev, d) => showTip(ev, d))
      .on("mouseleave", () => tooltip.style("opacity", 0));

    // Country labels — left-aligned in left margin, vertically centred on band
    svg.append("g").selectAll("text")
      .data(bars).join("text")
      .attr("x", ml - 8)
      .attr("y", (d) => yScale(d.country) + yScale.bandwidth() / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", "end")
      .attr("fill", "#1f2937")
      .attr("font-size", "12px")
      .attr("font-family", "Georgia,serif")
      .text((d) => d.country);

    // Legend — two swatches below chart, centred
    const legY = mt + chartH + 22;
    const legX = vw / 2 - 130;
    [[COLOR_MALE, "Male migrants (left)"], [COLOR_FEMALE, "Female migrants (right)"]].forEach(([col, lbl], i) => {
      svg.append("rect").attr("x", legX + i * 220).attr("y", legY)
        .attr("width", 16).attr("height", 16).attr("fill", col).attr("rx", 3).attr("opacity", 0.85);
      svg.append("text").attr("x", legX + i * 220 + 22).attr("y", legY + 12)
        .attr("fill", "#1f2937").attr("font-size", "13px").attr("font-family", "Georgia,serif")
        .text(lbl);
    });

    const sortLabels = { total: "total migrants", gap: "% gender gap", female_ratio: "female ratio" };
    vizSummary.textContent = `Top ${bars.length} countries — sorted by ${sortLabels[state.sort]}`;
    yearDisplayEl.textContent = state.year;
    sortDisplayEl.textContent = `Sorted by ${sortLabels[state.sort]}`;

    function showTip(event, d) {
      const diff = pctDiff(d);
      const sign = diff >= 0 ? "+" : "";
      const dominant = diff >= 0 ? "female-skewed" : "male-skewed";
      tooltip
        .style("opacity", 1)
        .html(
          `<strong>${d.country}</strong> (${d.year})<br>` +
          `Male: <strong>${fmt(d.males)}</strong> &nbsp; Female: <strong>${fmt(d.females)}</strong><br>` +
          `Gender gap: <strong>${sign}${diff.toFixed(1)}%</strong> ${dominant}<br>` +
          `Female share: ${(d.female_ratio * 100).toFixed(1)}%`
        )
        .style("left", `${event.clientX + 14}px`)
        .style("top", `${event.clientY + 14}px`);
    }
  }

  async function init() {
    try {
      const resp = await fetch(endpoint);
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      apiData = await resp.json();
      buildLookup();
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

  document.querySelectorAll(".sort-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sort-chip").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.sort = btn.dataset.sort;
      renderChart();
    });
  });

  init();
})();
