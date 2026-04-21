(function () {
  const root = document.getElementById("stream-app");
  if (!root) return;

  const endpoint = root.dataset.endpoint;
  const svgEl = document.getElementById("stream-chart");
  const tooltipEl = document.getElementById("tooltip");
  const countrySelect = document.getElementById("country-select");
  const topkSlider = document.getElementById("topk-slider");
  const topkChip = document.getElementById("topk-chip");
  const vizSummary = document.getElementById("viz-summary");
  const chartTitleEl = document.getElementById("chart-title");
  const chartSubtitleEl = document.getElementById("chart-subtitle");
  const modeDisplayEl = document.getElementById("mode-display");
  const countryDisplayEl = document.getElementById("country-display");

  let apiData = null;
  let state = { mode: "outflow", country: "India", topK: 10, pct: "absolute" };
  let focusedKey = null; // clicked legend band

  const PALETTE = [
    "#6366f1","#f59e0b","#10b981","#f43f5e","#0ea5e9",
    "#a855f7","#84cc16","#fb923c","#14b8a6","#ec4899",
    "#64748b","#22c55e","#e11d48","#7c3aed","#0284c7",
    "#d97706","#059669","#dc2626","#4f46e5","#0891b2",
  ];

  const YEARS = ["1990","1995","2000","2005","2010","2015","2020","2024"];
  const colorMap = new Map();
  let colorIdx = 0;

  function partnerColor(name) {
    if (!colorMap.has(name)) { colorMap.set(name, PALETTE[colorIdx % PALETTE.length]); colorIdx++; }
    return colorMap.get(name);
  }

  function resetColors() { colorMap.clear(); colorIdx = 0; }

  function fmt(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toFixed(0);
  }

  function getRecords() {
    return state.mode === "outflow" ? apiData.outflow_records : apiData.inflow_records;
  }

  function buildStreamData() {
    const records = getRecords();
    const myRecords = records.filter((r) => r.country === state.country);

    const partnerTotals = new Map();
    myRecords.forEach((r) => {
      const total = YEARS.reduce((s, y) => s + (r.values[y] || 0), 0);
      partnerTotals.set(r.partner, (partnerTotals.get(r.partner) || 0) + total);
    });

    const sortedPartners = [...partnerTotals.entries()].sort((a, b) => b[1] - a[1]);
    const topPartners = sortedPartners.slice(0, state.topK).map(([p]) => p);
    const restPartners = new Set(sortedPartners.slice(state.topK).map(([p]) => p));

    const table = new Map();
    myRecords.forEach((r) => {
      const bucket = topPartners.includes(r.partner) ? r.partner
                   : restPartners.has(r.partner) ? "Rest of World" : null;
      if (!bucket) return;
      if (!table.has(bucket)) table.set(bucket, Object.fromEntries(YEARS.map((y) => [y, 0])));
      YEARS.forEach((y) => { table.get(bucket)[y] += r.values[y] || 0; });
    });

    const keys = [...topPartners];
    if (table.has("Rest of World")) keys.push("Rest of World");

    const flatData = YEARS.map((year) => {
      const row = { year };
      keys.forEach((k) => { row[k] = table.has(k) ? (table.get(k)[year] || 0) : 0; });
      if (state.pct === "percent") {
        const tot = keys.reduce((s, k) => s + (row[k] || 0), 0);
        if (tot > 0) keys.forEach((k) => { row[k] = (row[k] / tot) * 100; });
      }
      return row;
    });

    return { flatData, keys };
  }

  function applyFocus(paths, legendItems, focusKey) {
    if (!focusKey) {
      paths.attr("opacity", 0.82);
      legendItems.selectAll("rect").attr("opacity", 0.85);
      legendItems.selectAll("text").attr("opacity", 1);
    } else {
      paths.attr("opacity", (d) => d.key === focusKey ? 0.96 : 0.1);
      legendItems.selectAll("rect").attr("opacity", (d) => d === focusKey ? 1 : 0.3);
      legendItems.selectAll("text").attr("opacity", (d) => d === focusKey ? 1 : 0.4);
    }
  }

  function renderChart() {
    if (!apiData) return;

    const { flatData, keys } = buildStreamData();

    const vw = 1200, vh = 580;
    const ml = 60, mr = 30, mt = 20, mb = 110;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    const tooltip = d3.select(tooltipEl);

    if (!keys.length) {
      svg.append("text").attr("x", vw / 2).attr("y", vh / 2)
        .attr("text-anchor", "middle").attr("fill", "#5b5f67").attr("font-size", "14px")
        .text("No data for current selection.");
      return;
    }

    const stack = d3.stack().keys(keys)
      .order(d3.stackOrderInsideOut)
      .offset(d3.stackOffsetWiggle);
    const series = stack(flatData);

    const xScale = d3.scalePoint().domain(YEARS).range([ml, vw - mr]);
    const yExtent = [
      d3.min(series, (s) => d3.min(s, (d) => d[0])),
      d3.max(series, (s) => d3.max(s, (d) => d[1])),
    ];
    const yScale = d3.scaleLinear().domain(yExtent).range([vh - mb, mt]);
    const area = d3.area()
      .x((d, i) => xScale(YEARS[i]))
      .y0((d) => yScale(d[0])).y1((d) => yScale(d[1]))
      .curve(d3.curveCatmullRom.alpha(0.5));

    // Stream bands
    const paths = svg.append("g").selectAll("path")
      .data(series).join("path")
      .attr("class", "stream-band")
      .attr("d", area)
      .attr("fill", (d) => d.key === "Rest of World" ? "#9ca3af" : partnerColor(d.key))
      .attr("opacity", 0.82)
      .style("cursor", "pointer")
      .on("mouseover", (event, d) => {
        if (!focusedKey) {
          paths.attr("opacity", 0.15);
          d3.select(event.currentTarget).attr("opacity", 0.96);
        }
      })
      .on("mousemove", (event, d) => {
        const [mx] = d3.pointer(event, svgEl);
        const idx = Math.max(0, Math.min(YEARS.length - 1,
          Math.round((mx - ml) / ((vw - mr - ml) / (YEARS.length - 1)))));
        const year = YEARS[idx];
        const val = flatData[idx][d.key] || 0;
        const tot = keys.reduce((s, k) => s + (flatData[idx][k] || 0), 0);
        const share = tot > 0 ? ((val / tot) * 100).toFixed(1) : "0";
        const allTotal = series.find((s) => s.key === d.key)
          ?.reduce((s, pt) => s + (pt.data[d.key] || 0), 0) || 0;
        tooltip.style("opacity", 1)
          .html(
            `<strong>${d.key}</strong><br>Year: ${year}<br>` +
            `${state.pct === "percent" ? `Share: ${val.toFixed(1)}%` : `Migrants: ${fmt(val)}`}<br>` +
            (state.pct === "absolute" ? `Share: ${share}%<br>` : "") +
            `Total across years: ${fmt(allTotal)}`
          )
          .style("left", `${event.clientX + 14}px`)
          .style("top", `${event.clientY + 14}px`);
      })
      .on("mouseleave", () => {
        tooltip.style("opacity", 0);
        if (!focusedKey) paths.attr("opacity", 0.82);
      });

    // X axis
    svg.append("g")
      .attr("transform", `translate(0,${vh - mb + 10})`)
      .call(d3.axisBottom(xScale).tickSize(0))
      .call((g) => {
        g.select(".domain").remove();
        g.selectAll("text").attr("fill", "#5b5f67").attr("font-size", "13px").attr("font-family", "Georgia,serif");
      });

    // Year tick marks
    svg.append("g").selectAll("line.yt")
      .data(YEARS).join("line")
      .attr("x1", (y) => xScale(y)).attr("x2", (y) => xScale(y))
      .attr("y1", vh - mb + 2).attr("y2", vh - mb + 8)
      .attr("stroke", "rgba(31,41,55,0.2)").attr("stroke-width", 1);

    // Y axis label
    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -(vh - mb + mt) / 2).attr("y", 14)
      .attr("text-anchor", "middle").attr("fill", "#5b5f67")
      .attr("font-size", "12px").attr("font-family", "Georgia,serif")
      .text(state.pct === "percent" ? "% Share" : "Migrants");

    // Clickable legend — horizontal, below x-axis
    const legRowH = 22, legSwatchW = 14, legColW = 210;
    const legCols = Math.min(keys.length, Math.floor((vw - ml - mr) / legColW));
    const legStartX = ml;
    const legStartY = vh - mb + 30;

    const legendItems = svg.append("g").attr("class", "legend")
      .selectAll("g")
      .data(keys).join("g")
      .attr("transform", (k, i) => {
        const col = i % legCols, row = Math.floor(i / legCols);
        return `translate(${legStartX + col * legColW},${legStartY + row * legRowH})`;
      })
      .style("cursor", "pointer")
      .on("click", (event, k) => {
        focusedKey = focusedKey === k ? null : k;
        applyFocus(paths, legendItems, focusedKey);
      })
      .on("mouseover", (event, k) => {
        if (!focusedKey) {
          paths.attr("opacity", (d) => d.key === k ? 0.96 : 0.1);
        }
      })
      .on("mouseleave", () => {
        if (!focusedKey) paths.attr("opacity", 0.82);
      });

    legendItems.append("rect")
      .attr("width", legSwatchW).attr("height", legSwatchW)
      .attr("fill", (k) => k === "Rest of World" ? "#9ca3af" : partnerColor(k))
      .attr("rx", 3).attr("opacity", 0.85);

    legendItems.append("text")
      .attr("x", legSwatchW + 6).attr("y", 11)
      .attr("fill", "#1f2937").attr("font-size", "12px").attr("font-family", "Georgia,serif")
      .text((k) => k.length > 24 ? k.slice(0, 23) + "…" : k);

    // Restore focus state after re-render
    applyFocus(paths, legendItems, focusedKey);

    const isOut = state.mode === "outflow";
    chartTitleEl.textContent = isOut ? `Outflow from ${state.country}` : `Inflow into ${state.country}`;
    chartSubtitleEl.textContent = isOut
      ? "Bands = destination countries, width = emigrant volume"
      : "Bands = origin countries, width = immigrant volume";
    modeDisplayEl.textContent = isOut ? "Outflow" : "Inflow";
    countryDisplayEl.textContent = state.country;
    vizSummary.textContent = `${keys.length} partners shown${keys.includes("Rest of World") ? " (incl. Rest of World)" : ""} — click legend to highlight`;
  }

  function populateCountrySelect() {
    const countries = apiData.countries;
    countries.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c; opt.textContent = c;
      countrySelect.appendChild(opt);
    });
    const def = countries.includes("India") ? "India" : countries[0];
    state.country = def;
    countrySelect.value = def;
  }

  async function init() {
    try {
      const resp = await fetch(endpoint);
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      apiData = await resp.json();
      populateCountrySelect();
      resetColors();
      renderChart();
    } catch (err) {
      vizSummary.textContent = "Failed to load data.";
      console.error(err);
    }
  }

  document.querySelectorAll(".mode-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mode-chip").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.mode = btn.dataset.mode;
      focusedKey = null;
      resetColors();
      renderChart();
    });
  });

  document.querySelectorAll(".pct-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".pct-chip").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.pct = btn.dataset.pct;
      renderChart();
    });
  });

  countrySelect.addEventListener("change", () => {
    state.country = countrySelect.value;
    focusedKey = null;
    resetColors();
    renderChart();
  });

  topkSlider.addEventListener("input", (e) => {
    state.topK = Number(e.target.value);
    topkChip.textContent = state.topK;
    focusedKey = null;
    resetColors();
    renderChart();
  });

  init();
})();
