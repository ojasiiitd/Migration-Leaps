(function () {
  "use strict";

  const root = document.getElementById("d2-app");
  if (!root) return;

  const ENDPOINT = root.dataset.endpoint;

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const tooltip      = d3.select("#d2-tooltip");
  const yearSlider   = document.getElementById("d2-year-slider");
  const yearChip     = document.getElementById("d2-year-chip");
  const topkSlider   = document.getElementById("d2-topk-slider");
  const topkChip     = document.getElementById("d2-topk-chip");
  const selLabel     = document.getElementById("d2-sel-label");
  const countryChip  = document.getElementById("d2-country-chip");
  const clearBtn     = document.getElementById("d2-clear-btn");
  const corridorLbl  = document.getElementById("d2-corridor-label");
  const brushInfo    = document.getElementById("d2-brush-info");
  const streamTitle  = document.getElementById("d2-stream-title");
  const barSummary   = document.getElementById("d2-bar-summary");
  const chordSummary = document.getElementById("d2-chord-summary");
  const streamSummary= document.getElementById("d2-stream-summary");

  // ── Shared state ─────────────────────────────────────────────────────────
  let apiData = null;
  let state = {
    year: "2020",
    topK: 20,
    metric: "absolute",   // "absolute" | "percent"
    flow: "outflow",      // "outflow" | "inflow"
    selectedCountry: null,
    hoveredRibbon: null,  // { src, tgt }
    lockedRibbon: null,   // { src, tgt }
    brushYears: null,     // [startYear, endYear] strings, null = no brush
  };

  // ── Colours ──────────────────────────────────────────────────────────────
  const COLOR_MALE   = "#3b82f6";
  const COLOR_FEMALE = "#f97316";
  const CONTINENT_COLOR = {
    "Africa": "#f59e0b", "Asia": "#6366f1", "Europe": "#0ea5e9",
    "North America": "#10b981", "South America": "#f43f5e", "Oceania": "#a855f7",
  };
  const DEFAULT_COLOR = "#9ca3af";
  const STREAM_PALETTE = [
    "#6366f1","#f59e0b","#10b981","#f43f5e","#0ea5e9",
    "#a855f7","#84cc16","#fb923c","#14b8a6","#ec4899",
    "#64748b","#22c55e","#e11d48","#7c3aed","#0284c7",
    "#d97706","#059669","#dc2626","#4f46e5","#0891b2",
  ];
  const YEARS = ["1990","1995","2000","2005","2010","2015","2020","2024"];

  const streamColorMap = new Map();
  let streamColorIdx = 0;
  function streamColor(name) {
    if (!streamColorMap.has(name)) {
      streamColorMap.set(name, STREAM_PALETTE[streamColorIdx % STREAM_PALETTE.length]);
      streamColorIdx++;
    }
    return streamColorMap.get(name);
  }

  function fmt(n) {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toFixed ? n.toFixed(0) : String(n);
  }

  function tip(html, event) {
    tooltip.style("opacity", 1).html(html)
      .style("left", `${event.clientX + 14}px`)
      .style("top",  `${event.clientY + 14}px`);
  }
  function hideTip() { tooltip.style("opacity", 0); }

  // ── Year range from brush ─────────────────────────────────────────────────
  function activeYears() {
    if (!state.brushYears) return YEARS;
    const [y0, y1] = state.brushYears;
    return YEARS.filter(y => y >= y0 && y <= y1);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DIVERGING BAR
  // ─────────────────────────────────────────────────────────────────────────
  function renderBar() {
    const svgEl = document.getElementById("d2-bar-chart");
    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const years = state.brushYears ? activeYears() : [state.year];
    const records = apiData.bar_records;

    // Aggregate over selected years
    const byCountry = new Map();
    for (const r of records) {
      if (!years.includes(r.year)) continue;
      if (!byCountry.has(r.country)) byCountry.set(r.country, { males: 0, females: 0 });
      const e = byCountry.get(r.country);
      e.males += r.males;
      e.females += r.females;
    }

    let bars = [...byCountry.entries()].map(([country, v]) => ({
      country, ...v, total: v.males + v.females
    })).filter(d => d.total > 0);

    // Sort: if a country is selected push it top, then sort by total
    bars.sort((a, b) => b.total - a.total);
    bars = bars.slice(0, state.topK);

    if (!bars.length) { barSummary.textContent = "No data."; return; }

    if (state.metric === "percent") {
      bars.forEach(d => {
        const t = d.males + d.females;
        d.malePct  = t > 0 ? (d.males   / t * 100) : 0;
        d.femalePct= t > 0 ? (d.females / t * 100) : 0;
      });
    }

    const vw = 560, barH = 22, pad = 5;
    const ml = 168, mr = 16, mt = 52, mb = 40;
    const chartH = bars.length * (barH + pad);
    const vh = mt + chartH + mb;

    svgEl.setAttribute("viewBox", `0 0 ${vw} ${vh}`);

    const useVal = (d, side) => state.metric === "percent"
      ? (side === "male" ? d.malePct : d.femalePct)
      : (side === "male" ? d.males   : d.females);

    const maxVal = state.metric === "percent" ? 100
      : d3.max(bars, d => Math.max(d.males, d.females));

    const xScale = d3.scaleLinear().domain([-maxVal, maxVal]).range([ml, vw - mr]).nice();
    const yScale = d3.scaleBand().domain(bars.map(d => d.country))
      .range([mt, mt + chartH]).padding(pad / (barH + pad));
    const xZero = xScale(0);

    // gridlines
    svg.append("g").attr("transform", `translate(0,${mt})`)
      .call(d3.axisTop(xScale).ticks(5).tickSize(chartH).tickFormat(""))
      .call(g => { g.select(".domain").remove(); g.selectAll("line").attr("stroke","rgba(31,41,55,0.06)"); });

    // zero line
    svg.append("line")
      .attr("x1", xZero).attr("x2", xZero).attr("y1", mt - 8).attr("y2", mt + chartH)
      .attr("stroke","rgba(31,41,55,0.25)").attr("stroke-width",1.5).attr("stroke-dasharray","4,3");

    // x axis
    svg.append("g").attr("transform", `translate(0,${mt})`)
      .call(d3.axisTop(xScale).ticks(5).tickFormat(d =>
        state.metric === "percent" ? `${Math.abs(d)}%` : fmt(Math.abs(d))
      ))
      .call(g => {
        g.select(".domain").remove();
        g.selectAll("text").attr("fill","#5b5f67").attr("font-size","11px").attr("font-family","Georgia,serif");
        g.selectAll("line").attr("stroke","transparent");
      });

    // direction labels
    svg.append("text").attr("x", ml + 8).attr("y", mt - 28)
      .attr("fill", COLOR_MALE).attr("font-size","12px").attr("font-family","Georgia,serif")
      .attr("font-weight","bold").text("← Male");
    svg.append("text").attr("x", vw - mr - 8).attr("y", mt - 28)
      .attr("text-anchor","end").attr("fill", COLOR_FEMALE)
      .attr("font-size","12px").attr("font-family","Georgia,serif")
      .attr("font-weight","bold").text("Female →");

    function barOpacity(d) {
      if (!state.selectedCountry) return 0.82;
      return d.country === state.selectedCountry ? 1 : 0.18;
    }

    function barStroke(d) {
      return d.country === state.selectedCountry ? "#1f2937" : "none";
    }

    // male bars
    const maleBars = svg.append("g").selectAll("rect").data(bars).join("rect")
      .attr("x", d => xScale(-useVal(d, "male")))
      .attr("y", d => yScale(d.country))
      .attr("width", d => Math.max(0, xZero - xScale(-useVal(d, "male"))))
      .attr("height", yScale.bandwidth())
      .attr("fill", COLOR_MALE).attr("rx", 3)
      .attr("opacity", d => barOpacity(d))
      .attr("stroke", d => barStroke(d))
      .attr("stroke-width", 1.5)
      .style("cursor","pointer")
      .on("click", (ev, d) => selectCountry(d.country))
      .on("mousemove", (ev, d) => tip(
        `<strong>${d.country}</strong><br>Male: <strong>${fmt(d.males)}</strong><br>Female: <strong>${fmt(d.females)}</strong>`,
        ev))
      .on("mouseleave", hideTip);

    // female bars
    const femaleBars = svg.append("g").selectAll("rect").data(bars).join("rect")
      .attr("x", xZero)
      .attr("y", d => yScale(d.country))
      .attr("width", d => Math.max(0, xScale(useVal(d, "female")) - xZero))
      .attr("height", yScale.bandwidth())
      .attr("fill", COLOR_FEMALE).attr("rx", 3)
      .attr("opacity", d => barOpacity(d))
      .attr("stroke", d => barStroke(d))
      .attr("stroke-width", 1.5)
      .style("cursor","pointer")
      .on("click", (ev, d) => selectCountry(d.country))
      .on("mousemove", (ev, d) => tip(
        `<strong>${d.country}</strong><br>Male: <strong>${fmt(d.males)}</strong><br>Female: <strong>${fmt(d.females)}</strong>`,
        ev))
      .on("mouseleave", hideTip);

    // country labels
    svg.append("g").selectAll("text").data(bars).join("text")
      .attr("x", ml - 6)
      .attr("y", d => yScale(d.country) + yScale.bandwidth() / 2)
      .attr("dy","0.35em").attr("text-anchor","end")
      .attr("fill", d => d.country === state.selectedCountry ? var_accent() : "#1f2937")
      .attr("font-size","11px").attr("font-family","Georgia,serif")
      .attr("font-weight", d => d.country === state.selectedCountry ? "bold" : "normal")
      .style("cursor","pointer")
      .on("click", (ev, d) => selectCountry(d.country))
      .text(d => d.country);

    const yearLabel = state.brushYears
      ? `${state.brushYears[0]}–${state.brushYears[1]}`
      : state.year;
    barSummary.textContent = `Top ${bars.length} countries · ${yearLabel}`;
  }

  function var_accent() { return "#0f766e"; }

  // ─────────────────────────────────────────────────────────────────────────
  // CHORD DIAGRAM
  // ─────────────────────────────────────────────────────────────────────────
  function renderChord() {
    const svgEl = document.getElementById("d2-chord-chart");
    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const years = state.brushYears ? activeYears() : [state.year];

    // aggregate corridors over years
    const volumeMap = new Map(); // "src||tgt" → total
    for (const yr of years) {
      const corridors = apiData.corridors_by_year[yr] || [];
      for (const c of corridors) {
        const key = `${c.source}||${c.target}`;
        volumeMap.set(key, (volumeMap.get(key) || 0) + c.value);
      }
    }

    // top-K corridors
    let allCorridors = [...volumeMap.entries()].map(([k, v]) => {
      const [source, target] = k.split("||");
      return { source, target, value: v };
    });
    allCorridors.sort((a, b) => b.value - a.value);

    // if country selected, include all its corridors first
    let topCorridors;
    if (state.selectedCountry) {
      const countryCorridors = allCorridors.filter(
        c => c.source === state.selectedCountry || c.target === state.selectedCountry
      ).slice(0, Math.ceil(state.topK * 0.6));
      const rest = allCorridors.filter(
        c => c.source !== state.selectedCountry && c.target !== state.selectedCountry
      ).slice(0, state.topK - countryCorridors.length);
      topCorridors = [...countryCorridors, ...rest];
    } else {
      topCorridors = allCorridors.slice(0, state.topK);
    }

    if (!topCorridors.length) { chordSummary.textContent = "No data."; return; }

    const countrySet = new Set();
    topCorridors.forEach(c => { countrySet.add(c.source); countrySet.add(c.target); });
    const countries = Array.from(countrySet);
    const n = countries.length;
    const indexMap = new Map(countries.map((c, i) => [c, i]));

    const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
    topCorridors.forEach(c => {
      const i = indexMap.get(c.source), j = indexMap.get(c.target);
      if (i !== undefined && j !== undefined) matrix[i][j] += c.value;
    });

    const chord = d3.chord().padAngle(0.04).sortSubgroups(d3.descending).sortChords(d3.descending);
    const chords = chord(matrix);

    const W = svgEl.getBoundingClientRect().width || 480;
    const R_OUTER = 200, R_INNER = 175;
    const VW = 520, VH = 520;
    svgEl.setAttribute("viewBox", `${-VW/2} ${-VH/2} ${VW} ${VH}`);

    const arc    = d3.arc().innerRadius(R_INNER).outerRadius(R_OUTER);
    const ribbon = d3.ribbon().radius(R_INNER - 2);

    function countryColor(name) {
      const c = apiData.country_to_continent[name];
      return c ? CONTINENT_COLOR[c] : DEFAULT_COLOR;
    }

    // Groups
    const groupG = svg.append("g").selectAll("g").data(chords.groups).join("g");
    groupG.append("path")
      .attr("d", arc)
      .attr("fill", d => countryColor(countries[d.index]))
      .attr("stroke","#fff").attr("stroke-width",1)
      .attr("opacity", d => groupOpacity(countries[d.index]))
      .style("cursor","pointer")
      .on("click",  (ev, d) => selectCountry(countries[d.index]))
      .on("mouseover", (ev, d) => {
        const name = countries[d.index];
        const out = topCorridors.filter(c => c.source === name).reduce((s,c)=>s+c.value,0);
        const inn = topCorridors.filter(c => c.target === name).reduce((s,c)=>s+c.value,0);
        tip(`<strong>${name}</strong><br>Outflow: ${fmt(out)}<br>Inflow: ${fmt(inn)}`, ev);
        hoverCountryOnChord(name);
      })
      .on("mouseleave", () => { hideTip(); clearChordHover(); });

    groupG.append("text")
      .each(d => { d.angle = (d.startAngle + d.endAngle) / 2; })
      .attr("dy","0.35em")
      .attr("transform", d => {
        const a = (d.startAngle + d.endAngle) / 2;
        const flip = a > Math.PI ? "rotate(180)" : "";
        return `rotate(${(a * 180 / Math.PI) - 90}) translate(${R_OUTER + 8},0) ${flip}`;
      })
      .attr("text-anchor", d => (d.startAngle + d.endAngle) / 2 > Math.PI ? "end" : "start")
      .attr("font-size","11px").attr("font-family","Georgia,serif").attr("fill","#1f2937")
      .text(d => countries[d.index])
      .style("pointer-events","none");

    // Ribbons
    const ribbonG = svg.append("g").attr("fill-opacity", 0.65);
    const ribbonPaths = ribbonG.selectAll("path").data(chords).join("path")
      .attr("class","d2-ribbon")
      .attr("d", ribbon)
      .attr("fill", d => countryColor(countries[d.source.index]))
      .attr("stroke", d => d3.color(countryColor(countries[d.source.index])).darker(0.5))
      .attr("stroke-width", 0.5)
      .attr("opacity", d => ribbonOpacity(countries[d.source.index], countries[d.target.index]))
      .style("cursor","pointer")
      .on("mouseover", (ev, d) => {
        const src = countries[d.source.index], tgt = countries[d.target.index];
        const fwd = matrix[d.source.index][d.target.index];
        const bck = matrix[d.target.index][d.source.index];
        corridorLbl.textContent = `${src} ↔ ${tgt}`;
        state.hoveredRibbon = { src, tgt };
        tip(
          `<strong>${src} → ${tgt}</strong><br>`+
          (fwd ? `${src}→${tgt}: ${fmt(fwd)}<br>` : "") +
          (bck ? `${tgt}→${src}: ${fmt(bck)}` : ""),
          ev
        );
        refreshHighlights();
      })
      .on("mouseleave", () => {
        hideTip();
        state.hoveredRibbon = null;
        corridorLbl.textContent = state.lockedRibbon
          ? `${state.lockedRibbon.src} ↔ ${state.lockedRibbon.tgt} (locked)`
          : "—";
        refreshHighlights();
      })
      .on("click", (ev, d) => {
        const src = countries[d.source.index], tgt = countries[d.target.index];
        if (state.lockedRibbon && state.lockedRibbon.src === src && state.lockedRibbon.tgt === tgt) {
          state.lockedRibbon = null;
          corridorLbl.textContent = "—";
        } else {
          state.lockedRibbon = { src, tgt };
          corridorLbl.textContent = `${src} ↔ ${tgt} (locked)`;
        }
        refreshHighlights();
        renderStream();
      });

    // Legend
    const presentContinents = new Set(countries.map(c => apiData.country_to_continent[c]).filter(Boolean));
    const legendData = Object.entries(CONTINENT_COLOR).filter(([k]) => presentContinents.has(k));
    const legCols = 3, legColW = 140, legRowH = 22;
    const legRows = Math.ceil(legendData.length / legCols);
    const legW = legCols * legColW;
    const legY = R_OUTER + 24;

    const legG = svg.append("g").attr("transform", `translate(${-legW/2},${legY})`);
    legendData.forEach(([continent, color], i) => {
      const col = i % legCols, row = Math.floor(i / legCols);
      const lx = col * legColW, ly = row * legRowH;
      legG.append("rect").attr("x",lx).attr("y",ly).attr("width",14).attr("height",14)
        .attr("fill",color).attr("rx",3);
      legG.append("text").attr("x",lx+20).attr("y",ly+11)
        .attr("font-size","11px").attr("fill","#1f2937").attr("font-family","Georgia,serif")
        .text(continent);
    });

    chordSummary.textContent = `${topCorridors.length} corridors · ${countries.length} countries`;

    function hoverCountryOnChord(name) {
      groupG.selectAll("path").attr("opacity", d => d.index === indexMap.get(name) ? 1 : 0.3);
      ribbonPaths.attr("opacity", d =>
        countries[d.source.index] === name || countries[d.target.index] === name ? 0.9 : 0.06
      );
    }

    function clearChordHover() {
      groupG.selectAll("path").attr("opacity", d => groupOpacity(countries[d.index]));
      ribbonPaths.attr("opacity", d => ribbonOpacity(countries[d.source.index], countries[d.target.index]));
    }
  }

  function groupOpacity(name) {
    if (!state.selectedCountry) return 0.9;
    return name === state.selectedCountry ? 1 : 0.4;
  }

  function ribbonOpacity(src, tgt) {
    const locked = state.lockedRibbon;
    const hovered = state.hoveredRibbon;
    if (locked) {
      const match = (locked.src === src && locked.tgt === tgt) || (locked.src === tgt && locked.tgt === src);
      return match ? 0.9 : 0.07;
    }
    if (hovered) {
      const match = (hovered.src === src && hovered.tgt === tgt) || (hovered.src === tgt && hovered.tgt === src);
      return match ? 0.9 : 0.07;
    }
    if (state.selectedCountry) {
      return (src === state.selectedCountry || tgt === state.selectedCountry) ? 0.75 : 0.12;
    }
    return 0.65;
  }

  function refreshHighlights() {
    // Re-apply chord highlights without full re-render
    d3.selectAll(".d2-ribbon").attr("opacity", d => {
      const svg = document.getElementById("d2-chord-chart");
      // We can't easily access countries[] here — just re-render chord
    });
    renderChord();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STREAMGRAPH
  // ─────────────────────────────────────────────────────────────────────────
  function renderStream() {
    const svgEl = document.getElementById("d2-stream-chart");
    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const records = state.flow === "outflow" ? apiData.outflow_records : apiData.inflow_records;
    const country = state.selectedCountry || (apiData.countries[0]);

    if (!country) return;

    const myRecords = records.filter(r => r.country === country);

    // compute partner totals (all years)
    const partnerTotals = new Map();
    myRecords.forEach(r => {
      const tot = YEARS.reduce((s, y) => s + (r.values[y] || 0), 0);
      partnerTotals.set(r.partner, (partnerTotals.get(r.partner) || 0) + tot);
    });
    const sortedPartners = [...partnerTotals.entries()].sort((a, b) => b[1] - a[1]);
    const topPartners = sortedPartners.slice(0, state.topK).map(([p]) => p);

    const table = new Map();
    myRecords.forEach(r => {
      const bucket = topPartners.includes(r.partner) ? r.partner
                   : (partnerTotals.has(r.partner) ? "Rest of World" : null);
      if (!bucket) return;
      if (!table.has(bucket)) table.set(bucket, Object.fromEntries(YEARS.map(y => [y, 0])));
      YEARS.forEach(y => { table.get(bucket)[y] += r.values[y] || 0; });
    });

    const keys = [...topPartners.filter(p => table.has(p))];
    if (table.has("Rest of World")) keys.push("Rest of World");

    if (!keys.length) {
      streamTitle.textContent = "No data for this country.";
      return;
    }

    const flatData = YEARS.map(year => {
      const row = { year };
      keys.forEach(k => { row[k] = table.has(k) ? (table.get(k)[year] || 0) : 0; });
      if (state.metric === "percent") {
        const tot = keys.reduce((s, k) => s + (row[k] || 0), 0);
        if (tot > 0) keys.forEach(k => { row[k] = (row[k] / tot) * 100; });
      }
      return row;
    });

    const vw = 1200, vh = 420;
    const ml = 56, mr = 24, mt = 20, mb = 120;
    svgEl.setAttribute("viewBox", `0 0 ${vw} ${vh}`);

    const stack = d3.stack().keys(keys)
      .order(d3.stackOrderInsideOut).offset(d3.stackOffsetWiggle);
    const series = stack(flatData);

    const xScale = d3.scalePoint().domain(YEARS).range([ml, vw - mr]);
    const yExtent = [
      d3.min(series, s => d3.min(s, d => d[0])),
      d3.max(series, s => d3.max(s, d => d[1])),
    ];
    const yScale = d3.scaleLinear().domain(yExtent).range([vh - mb, mt]);
    const area = d3.area()
      .x((d, i) => xScale(YEARS[i]))
      .y0(d => yScale(d[0])).y1(d => yScale(d[1]))
      .curve(d3.curveCatmullRom.alpha(0.5));

    // Determine highlight key from locked/hovered ribbon
    let highlightKey = null;
    const ribbon = state.lockedRibbon || state.hoveredRibbon;
    if (ribbon) {
      // figure out which partner to highlight
      const partner = ribbon.src === country ? ribbon.tgt
                    : ribbon.tgt === country ? ribbon.src : null;
      if (partner && keys.includes(partner)) highlightKey = partner;
    }

    // Brush range shade
    const brushG = svg.append("g").attr("class","d2-brush-shade");
    if (state.brushYears) {
      const x0 = xScale(state.brushYears[0]);
      const x1 = xScale(state.brushYears[1]);
      brushG.append("rect")
        .attr("x", x0).attr("y", mt - 10)
        .attr("width", Math.max(0, x1 - x0))
        .attr("height", vh - mb - mt + 10)
        .attr("fill", "rgba(15,118,110,0.07)")
        .attr("stroke", "rgba(15,118,110,0.25)")
        .attr("stroke-width", 1)
        .attr("rx", 4);
    }

    const paths = svg.append("g").selectAll("path")
      .data(series).join("path")
      .attr("class","stream-band")
      .attr("d", area)
      .attr("fill", d => d.key === "Rest of World" ? "#9ca3af" : streamColor(d.key))
      .attr("opacity", d => {
        if (!highlightKey) return 0.82;
        return d.key === highlightKey ? 0.96 : 0.1;
      })
      .style("cursor","pointer")
      .on("mouseover", (ev, d) => {
        if (!highlightKey) {
          paths.attr("opacity", s => s.key === d.key ? 0.96 : 0.1);
        }
      })
      .on("mousemove", (ev, d) => {
        const [mx] = d3.pointer(ev, svgEl);
        const idx = Math.max(0, Math.min(YEARS.length - 1,
          Math.round((mx - ml) / ((vw - mr - ml) / (YEARS.length - 1)))));
        const year = YEARS[idx];
        const val = flatData[idx][d.key] || 0;
        tip(`<strong>${d.key}</strong><br>Year: ${year}<br>` +
          (state.metric === "percent" ? `Share: ${val.toFixed(1)}%` : `Migrants: ${fmt(val)}`), ev);
      })
      .on("mouseleave", () => {
        hideTip();
        if (!highlightKey) paths.attr("opacity", 0.82);
      });

    // X axis
    svg.append("g").attr("transform", `translate(0,${vh - mb + 10})`)
      .call(d3.axisBottom(xScale).tickSize(0))
      .call(g => {
        g.select(".domain").remove();
        g.selectAll("text").attr("fill","#5b5f67").attr("font-size","13px").attr("font-family","Georgia,serif");
      });

    // Y axis label
    svg.append("text").attr("transform","rotate(-90)")
      .attr("x", -(vh - mb + mt) / 2).attr("y", 14)
      .attr("text-anchor","middle").attr("fill","#5b5f67")
      .attr("font-size","11px").attr("font-family","Georgia,serif")
      .text(state.metric === "percent" ? "% Share" : "Migrants");

    // Legend
    const legRowH = 22, legColW = 200;
    const legCols = Math.max(1, Math.floor((vw - ml - mr) / legColW));
    const legStartX = ml, legStartY = vh - mb + 30;

    svg.append("g").selectAll("g").data(keys).join("g")
      .attr("transform", (k, i) => {
        const col = i % legCols, row = Math.floor(i / legCols);
        return `translate(${legStartX + col * legColW},${legStartY + row * legRowH})`;
      })
      .style("cursor","pointer")
      .each(function(k) {
        const g = d3.select(this);
        g.append("rect").attr("width",14).attr("height",14)
          .attr("fill", k === "Rest of World" ? "#9ca3af" : streamColor(k))
          .attr("rx", 3)
          .attr("opacity", highlightKey ? (k === highlightKey ? 1 : 0.3) : 0.85);
        g.append("text").attr("x", 20).attr("y", 11)
          .attr("fill","#1f2937").attr("font-size","11px").attr("font-family","Georgia,serif")
          .text(k.length > 26 ? k.slice(0,25) + "…" : k)
          .attr("opacity", highlightKey ? (k === highlightKey ? 1 : 0.35) : 1);
      });

    // Brush overlay for time filtering
    const brushXScale = xScale;
    const brush = d3.brushX()
      .extent([[ml, mt - 10], [vw - mr, vh - mb + 10]])
      .on("end", ({ selection }) => {
        if (!selection) {
          state.brushYears = null;
          brushInfo.textContent = "Drag the stream to filter time range";
        } else {
          const [x0, x1] = selection;
          // find closest years
          const y0 = YEARS.reduce((best, y) => Math.abs(brushXScale(y) - x0) < Math.abs(brushXScale(best) - x0) ? y : best, YEARS[0]);
          const y1 = YEARS.reduce((best, y) => Math.abs(brushXScale(y) - x1) < Math.abs(brushXScale(best) - x1) ? y : best, YEARS[YEARS.length-1]);
          state.brushYears = [y0, y1];
          brushInfo.textContent = `Time filter: ${y0} – ${y1} · Clear by double-clicking`;
        }
        renderBar();
        renderChord();
        renderStream();
      })
      .on("start", ({ selection }) => {
        if (!selection) return;
      });

    svg.append("g").attr("class","d2-brush").call(brush);

    // Restore brush visual if state exists
    if (state.brushYears) {
      const x0 = xScale(state.brushYears[0]);
      const x1 = xScale(state.brushYears[1]);
      svg.select(".d2-brush").call(brush.move, [x0, x1]);
    }

    const isOut = state.flow === "outflow";
    streamTitle.textContent = isOut
      ? `Outflow from ${country} — where they go over time`
      : `Inflow into ${country} — where they come from over time`;
    streamSummary.textContent = `${keys.length} partner bands · click legend to focus`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State mutations & re-render
  // ─────────────────────────────────────────────────────────────────────────
  function selectCountry(name) {
    if (state.selectedCountry === name) {
      state.selectedCountry = null;
      countryChip.textContent = "None";
      countryChip.classList.add("d2-chip-empty");
      selLabel.textContent = "(click bar)";
      clearBtn.style.display = "none";
    } else {
      state.selectedCountry = name;
      countryChip.textContent = name;
      countryChip.classList.remove("d2-chip-empty");
      selLabel.textContent = "";
      clearBtn.style.display = "inline-block";
    }
    state.lockedRibbon = null;
    corridorLbl.textContent = "—";
    renderAll();
  }

  function renderAll() {
    renderBar();
    renderChord();
    renderStream();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────────────────────────────────
  async function init() {
    try {
      const resp = await fetch(ENDPOINT);
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      apiData = await resp.json();

      yearSlider.max = String(apiData.years.length - 1);
      const defIdx = apiData.years.indexOf("2020");
      yearSlider.value = defIdx >= 0 ? String(defIdx) : String(apiData.years.length - 1);
      state.year = apiData.years[Number(yearSlider.value)];
      yearChip.textContent = state.year;

      // Default country = first with most total outflow
      state.selectedCountry = apiData.top_country || null;
      if (state.selectedCountry) {
        countryChip.textContent = state.selectedCountry;
        countryChip.classList.remove("d2-chip-empty");
        clearBtn.style.display = "inline-block";
      }

      renderAll();
    } catch (err) {
      barSummary.textContent = "Failed to load data.";
      console.error(err);
    }
  }

  // ── Control listeners ─────────────────────────────────────────────────────
  yearSlider.addEventListener("input", e => {
    state.year = apiData.years[Number(e.target.value)];
    yearChip.textContent = state.year;
    renderAll();
  });

  topkSlider.addEventListener("input", e => {
    state.topK = Number(e.target.value);
    topkChip.textContent = state.topK;
    streamColorMap.clear(); streamColorIdx = 0;
    renderAll();
  });

  document.querySelectorAll(".metric-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".metric-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.metric = btn.dataset.metric;
      renderAll();
    });
  });

  document.querySelectorAll(".flow-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".flow-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.flow = btn.dataset.flow;
      streamColorMap.clear(); streamColorIdx = 0;
      renderAll();
    });
  });

  clearBtn.addEventListener("click", () => {
    state.selectedCountry = null;
    countryChip.textContent = "None";
    countryChip.classList.add("d2-chip-empty");
    clearBtn.style.display = "none";
    selLabel.textContent = "(click bar)";
    state.lockedRibbon = null;
    corridorLbl.textContent = "—";
    renderAll();
  });

  init();
})();
