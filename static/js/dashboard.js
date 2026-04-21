(function () {
  "use strict";

  const appEl = document.getElementById("dashboard-app");
  if (!appEl) return;

  const SANKEY_EP   = appEl.dataset.sankey;
  const CHOROPLETH_EP = appEl.dataset.choropleth;
  const NETFLOW_EP  = appEl.dataset.netflow;

  const YEARS = ["1990","1995","2000","2005","2010","2015","2020","2024"];
  const TOP_N_LINKS = 20;
  const COLOR_GAIN = "#059669";
  const COLOR_LOSS = "#dc2626";

  // Continent tint colours used on map overlay and bar-chart column headings
  const CONT_COLORS = {
    "Africa":        "#f59e0b",
    "Asia":          "#6366f1",
    "Europe":        "#0ea5e9",
    "North America": "#10b981",
    "South America": "#f43f5e",
    "Oceania":       "#a855f7",
  };

  // ── Shared state ──────────────────────────────────────────────────────────
  const state = {
    year:            "2024",
    mode:            "destination",
    gender:          "total",
    sort:            "magnitude",
    originContinent: "Asia",
    destContinent:   "North America",
    selected:        new Set(),
    hovered:         null,
  };

  // ── Data ──────────────────────────────────────────────────────────────────
  let sankeyData = null;
  let choroplethData = null;
  let netflowData = null;
  let geoFeatures = null;

  let choroplethLookup = {};     // country -> year -> record
  let choroplethNormLookup = {}; // normalizedName -> country
  let topPartnersLookup = {};    // normalizedName -> year -> {inflow, outflow}

  // Map from country display-name -> continent (built from sankeyData)
  let countryToContinent = {};

  // ── DOM ───────────────────────────────────────────────────────────────────
  const tooltipEl   = document.getElementById("db-tooltip");
  const tooltip     = d3.select(tooltipEl);
  const yearSlider  = document.getElementById("db-year-slider");
  const yearChip    = document.getElementById("db-year-chip");
  const selDisplay  = document.getElementById("db-selection-display");
  const clearBtn    = document.getElementById("db-clear-btn");
  const origSel     = document.getElementById("db-origin-continent");
  const destSel     = document.getElementById("db-dest-continent");

  // ── Helpers ───────────────────────────────────────────────────────────────
  function fmt(n) {
    const a = Math.abs(n);
    if (a >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
    if (a >= 1_000)     return `${(n/1_000).toFixed(0)}K`;
    return String(n);
  }

  function normName(s) {
    return (s||"").toLowerCase()
      .replace(/\*/g,"").replace(/\(.*?\)/g,"").replace(/,\s*.*/g,"")
      .replace(/\s+/g," ").trim();
  }

  function matchGeo(geoName) {
    const n = normName(geoName);
    if (choroplethNormLookup[n]) return choroplethNormLookup[n];
    for (const [k,v] of Object.entries(choroplethNormLookup))
      if (k.startsWith(n) || n.startsWith(k)) return v;
    return null;
  }

  function choroVal(name) {
    const e = choroplethLookup[name]?.[state.year]; if (!e) return 0;
    const s = state.gender === "total" ? "_total" : `_${state.gender}`;
    return state.mode === "destination" ? (e[`inflow${s}`]||0) : (e[`outflow${s}`]||0);
  }

  function sankeyVal(row) {
    if (state.gender === "males")   return row.values_males?.[state.year]   || 0;
    if (state.gender === "females") return row.values_females?.[state.year] || 0;
    return row.values[state.year] || 0;
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────
  function tip(ev, html) {
    tooltip.style("opacity",1).html(html)
      .style("left",`${ev.clientX+14}px`).style("top",`${ev.clientY+14}px`);
  }
  function hideTip() { tooltip.style("opacity",0); }

  // ── Selection ─────────────────────────────────────────────────────────────
  function toggleSel(name) {
    if (state.selected.has(name)) state.selected.delete(name);
    else {
      if (state.selected.size >= 5) state.selected.delete(state.selected.values().next().value);
      state.selected.add(name);
    }
    updateSelUI();
    applyHighlights();
  }

  function updateSelUI() {
    selDisplay.innerHTML = "";
    state.selected.forEach((name) => {
      const ch = document.createElement("span");
      ch.className = "db-sel-chip";
      ch.textContent = name;
      ch.title = "Click to deselect";
      ch.onclick = () => { toggleSel(name); };
      selDisplay.appendChild(ch);
    });
    clearBtn.style.display = state.selected.size > 0 ? "inline-block" : "none";
  }

  // ── Continent membership helpers ──────────────────────────────────────────
  // Returns set of display-names belonging to a continent
  function continentDisplayNames(continent) {
    if (!sankeyData) return new Set();
    const raw = sankeyData.continent_countries[continent] || [];
    return new Set(raw.map((c) => sankeyData.country_meta[c].label));
  }

  // ── Cross-chart highlights (no re-render) ─────────────────────────────────
  function applyHighlights() {
    const sel  = state.selected;
    const hov  = state.hovered;
    const active = sel.size > 0 ? sel : (hov ? new Set([hov]) : null);

    // ── Sankey links
    d3.select("#db-sankey-chart").selectAll(".db-link")
      .attr("opacity", function() {
        if (!active) return 0.34;
        const d = d3.select(this).datum();
        if (!d) return 0.1;
        return (active.has(d._srcLabel) || active.has(d._tgtLabel)) ? 0.78 : 0.05;
      });

    // ── Map paths
    d3.select("#db-map-svg").selectAll("path[data-country]")
      .attr("opacity", function() {
        if (!active) return 1;
        return active.has(d3.select(this).attr("data-country")) ? 1 : 0.22;
      })
      .attr("stroke-width", function() {
        const n = d3.select(this).attr("data-country");
        if (sel.has(n)) return 2.2;
        if (n === hov)  return 1.8;
        return 0.5;
      })
      .attr("stroke", function() {
        const n = d3.select(this).attr("data-country");
        if (sel.has(n) || n === hov) return "#1f2937";
        return "#fff";
      });

    // ── Netflow bars
    d3.select("#db-netflow-chart").selectAll("rect[data-country]")
      .attr("opacity", function() {
        if (!active) return 0.85;
        return active.has(d3.select(this).attr("data-country")) ? 1 : 0.15;
      })
      .attr("stroke", function() {
        const n = d3.select(this).attr("data-country");
        return (sel.has(n) || n === hov) ? "#1f2937" : "none";
      });
  }

  function onHover(name) { state.hovered = name; applyHighlights(); }
  function offHover()    { state.hovered = null;  applyHighlights(); }

  // ── SANKEY ────────────────────────────────────────────────────────────────
  function renderSankey() {
    if (!sankeyData) return;

    const svgEl = document.getElementById("db-sankey-chart");
    const sumEl = document.getElementById("db-sankey-summary");
    const svg   = d3.select(svgEl);
    svg.selectAll("*").remove();

    const W=1000, H=560, mL=185, mR=185, mT=14, mB=14;

    const notCross = (c) => !sankeyData.country_meta[c].cross_continent;
    const origins  = new Set(sankeyData.continent_countries[state.originContinent].filter(notCross));
    const dests    = new Set(sankeyData.continent_countries[state.destContinent].filter(notCross));

    const corridors = sankeyData.corridors
      .filter((r) => r.origin_continents.includes(state.originContinent))
      .filter((r) => r.destination_continents.includes(state.destContinent))
      .filter((r) => origins.has(r.source) && dests.has(r.target))
      .map((r) => ({ ...r, value: sankeyVal(r) }))
      .filter((r) => r.value > 0)
      .sort((a,b) => b.value - a.value)
      .slice(0, TOP_N_LINKS);

    if (!corridors.length) {
      sumEl.textContent = `No flows for ${state.originContinent} → ${state.destContinent} in ${state.year}`;
      return;
    }

    const total = corridors.reduce((s,r) => s+r.value, 0);
    const genderLabel = state.gender === "total" ? "all" : state.gender;
    sumEl.textContent = `${corridors.length} links — ${fmt(total)} (${genderLabel}) in ${state.year}`;

    const usedOrigins = new Set(corridors.map((r) => r.source));
    const usedDests   = new Set(corridors.map((r) => r.target));
    const meta = sankeyData.country_meta;

    const nodes = [
      ...Array.from(usedOrigins).map((c) => ({ id:`o:${c}`, country:c, side:"origin", label:meta[c].label })),
      ...Array.from(usedDests).map((c)   => ({ id:`d:${c}`, country:c, side:"dest",   label:meta[c].label })),
    ];
    const links = corridors.map((r) => ({ source:`o:${r.source}`, target:`d:${r.target}`, value:r.value }));

    const graph = d3.sankey()
      .nodeId((d) => d.id).nodeWidth(16).nodePadding(12)
      .extent([[mL,mT],[W-mR,H-mB]])
      ({ nodes: nodes.map((d)=>({...d})), links: links.map((d)=>({...d})) });

    const pal = d3.schemeTableau10;
    const colorMap = new Map(
      graph.nodes.filter((d) => d.side==="origin").map((d,i) => [d.country, pal[i%pal.length]])
    );

    // Links — store labels as custom props for highlight targeting
    svg.append("g").selectAll("path")
      .data(graph.links)
      .join("path")
      .attr("class","db-link")
      .attr("d", d3.sankeyLinkHorizontal())
      .attr("stroke", (d) => colorMap.get(d.source.country))
      .attr("stroke-width", (d) => Math.max(1, d.width))
      .attr("fill","none").attr("opacity",0.34)
      .each(function(d) {
        d._srcLabel = meta[d.source.country]?.label;
        d._tgtLabel = meta[d.target.country]?.label;
      })
      .on("mousemove", (ev,d) => {
        tip(ev,`<strong>${d._srcLabel}</strong> → <strong>${d._tgtLabel}</strong><br>${fmt(d.value)} migrants`);
        onHover(d._srcLabel);
      })
      .on("mouseleave", () => { hideTip(); offHover(); });

    // Nodes
    const node = svg.append("g").selectAll("g").data(graph.nodes).join("g").attr("class","node");

    node.filter((d) => d.side==="origin").append("rect")
      .attr("x",(d)=>d.x0).attr("y",(d)=>d.y0)
      .attr("width",(d)=>d.x1-d.x0).attr("height",(d)=>Math.max(1,d.y1-d.y0))
      .attr("fill",(d)=>colorMap.get(d.country)).attr("rx",2).style("cursor","pointer")
      .on("mousemove",(ev,d) => { tip(ev,`<strong>${d.label}</strong><br>${fmt(d.value)} total`); onHover(d.label); })
      .on("mouseleave",() => { hideTip(); offHover(); })
      .on("click",(ev,d) => toggleSel(d.label));

    node.filter((d) => d.side==="dest").each(function(d) {
      const g = d3.select(this);
      d.targetLinks.forEach((lk) =>
        g.append("rect")
          .attr("x",d.x0).attr("y",lk.y1-lk.width/2)
          .attr("width",d.x1-d.x0).attr("height",Math.max(1,lk.width))
          .attr("fill",colorMap.get(lk.source.country))
      );
      g.append("rect")
        .attr("x",d.x0).attr("y",d.y0).attr("width",d.x1-d.x0).attr("height",Math.max(1,d.y1-d.y0))
        .attr("fill","transparent").style("cursor","pointer")
        .on("mousemove",(ev) => { tip(ev,`<strong>${d.label}</strong><br>${fmt(d.value)} total`); onHover(d.label); })
        .on("mouseleave",() => { hideTip(); offHover(); })
        .on("click",() => toggleSel(d.label));
    });

    node.append("text").attr("class","node-label")
      .attr("x",(d) => d.side==="origin" ? d.x0-10 : d.x1+10)
      .attr("y",(d) => (d.y0+d.y1)/2-3)
      .attr("text-anchor",(d) => d.side==="origin" ? "end" : "start")
      .text((d) => d.label);

    node.append("text").attr("class","node-value")
      .attr("x",(d) => d.side==="origin" ? d.x0-10 : d.x1+10)
      .attr("y",(d) => (d.y0+d.y1)/2+13)
      .attr("text-anchor",(d) => d.side==="origin" ? "end" : "start")
      .text((d) => fmt(d.value));

    applyHighlights();
  }

  // ── CHOROPLETH ────────────────────────────────────────────────────────────
  // Build a set of all raw country names that belong to each continent
  let continentRawNames = {};  // continent -> Set of raw country names from CSV

  function buildContinentRawNames() {
    continentRawNames = {};
    if (!sankeyData) return;
    // sankeyData.continent_countries maps continent -> [raw country keys]
    Object.entries(sankeyData.continent_countries).forEach(([cont, rawList]) => {
      continentRawNames[cont] = new Set(rawList);
    });
  }

  // Returns which continent a choropleth country record belongs to
  function getCountryContinent(rawCountryName) {
    for (const [cont, nameSet] of Object.entries(continentRawNames)) {
      if (nameSet.has(rawCountryName)) return cont;
    }
    return null;
  }

  function renderMap() {
    if (!choroplethData || !geoFeatures) return;

    const svgEl   = document.getElementById("db-map-svg");
    const sumEl   = document.getElementById("db-map-summary");
    const legendEl = document.getElementById("db-map-legend");
    const contLeg  = document.getElementById("db-continent-legend");
    const svg     = d3.select(svgEl);
    svg.selectAll("*").remove();

    const proj = d3.geoNaturalEarth1().scale(153).translate([480,250]);
    const path = d3.geoPath().projection(proj);

    const allVals = Object.keys(choroplethLookup).map(choroVal).filter((v)=>v>0).sort(d3.ascending);
    const maxVal  = d3.quantile(allVals,0.97)||1;

    const colorScale = d3.scaleSequential()
      .domain([0,maxVal])
      .interpolator(state.mode==="destination" ? d3.interpolateBlues : d3.interpolatePurples)
      .clamp(true);

    svg.append("path").datum({type:"Sphere"}).attr("d",path).attr("fill","#dbeafe");
    svg.append("path").datum(d3.geoGraticule()()).attr("d",path)
      .attr("fill","none").attr("stroke","rgba(255,255,255,0.3)").attr("stroke-width",0.4);

    const origNames = continentRawNames[state.originContinent] || new Set();
    const destNames = continentRawNames[state.destContinent]   || new Set();

    svg.append("g").selectAll("path")
      .data(geoFeatures).join("path")
      .attr("d", path)
      .attr("data-country", (d) => matchGeo(d.properties?.name||"")||"")
      .attr("fill", (d) => {
        const m = matchGeo(d.properties?.name||"");
        if (!m) return "#e2e8f0";
        const v = choroVal(m);
        return v>0 ? colorScale(v) : "#e2e8f0";
      })
      .attr("stroke","#fff").attr("stroke-width",0.5)
      .style("cursor","pointer")
      .on("mousemove", function(ev,d) {
        const geo = d.properties?.name||"Unknown";
        const m   = matchGeo(geo);
        const val = m ? choroVal(m) : 0;
        const lbl = state.mode==="destination" ? "Immigrants" : "Emigrants";
        const normKey = normName(m||geo);
        const pdata = topPartnersLookup[normKey]?.[state.year];
        const plist = pdata ? (state.mode==="destination" ? pdata.inflow : pdata.outflow) : [];
        let phtml = "";
        if (plist.length) {
          const plbl = state.mode==="destination" ? "Top origins" : "Top destinations";
          phtml = `<div style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.2);padding-top:5px;">` +
            `<div style="font-size:0.78rem;color:rgba(255,255,255,0.6);margin-bottom:3px;">${plbl}:</div>` +
            plist.map((p,i)=>
              `<div style="display:flex;justify-content:space-between;gap:10px;font-size:0.81rem;">` +
              `<span>${i+1}. ${p.country}</span><span style="color:#86efac;">${fmt(p.value)}</span></div>`
            ).join("") + `</div>`;
        }
        tip(ev,`<strong>${geo}</strong><br>`+
          (val>0 ? `${lbl}: <strong>${fmt(val)}</strong>` : "No data")+phtml);
        if (m) onHover(m);
      })
      .on("mouseleave", function() { hideTip(); offHover(); })
      .on("click", function(ev,d) {
        const m = matchGeo(d.properties?.name||"");
        if (m) toggleSel(m);
      });

    // Continent overlay tint — draw a subtle filled overlay for origin/dest continents
    // by rendering a lasso over country paths belonging to each continent
    // We achieve this by drawing a second semi-transparent layer per continent
    const contOverlayData = [];
    geoFeatures.forEach((d) => {
      const geo = d.properties?.name||"";
      // Find the raw name that matches this geo feature
      const matched = matchGeo(geo);
      if (!matched) return;
      // Find which raw key matches
      let rawKey = null;
      for (const rawList of Object.values(sankeyData.continent_countries)) {
        for (const r of rawList) {
          const disp = sankeyData.country_meta[r]?.label;
          if (disp === matched || r === matched) { rawKey = r; break; }
        }
        if (rawKey) break;
      }
      if (origNames.has(rawKey)) contOverlayData.push({ feature: d, cont: "origin" });
      else if (destNames.has(rawKey)) contOverlayData.push({ feature: d, cont: "dest" });
    });

    if (contOverlayData.length) {
      const origColor = CONT_COLORS[state.originContinent] || "#b45309";
      const destColor = CONT_COLORS[state.destContinent]   || "#1d4ed8";
      svg.append("g").selectAll("path")
        .data(contOverlayData).join("path")
        .attr("d", (d) => path(d.feature))
        .attr("fill", (d) => d.cont==="origin" ? origColor : destColor)
        .attr("opacity", 0.18)
        .attr("stroke", (d) => d.cont==="origin" ? origColor : destColor)
        .attr("stroke-width", 1.2)
        .attr("stroke-opacity", 0.55)
        .attr("pointer-events","none");
    }

    // Legend
    const steps = 6;
    const sw = Array.from({length:steps},(_,i)=>{
      const v=(maxVal/(steps-1))*i;
      return `<span style="background:${colorScale(v)};display:inline-block;width:22px;height:9px;border-radius:2px;"></span>`;
    }).join("");
    legendEl.innerHTML =
      `<div class="legend-title">${state.mode==="destination"?"Immigrants":"Emigrants"} — ${state.year}</div>`+
      `<div style="display:flex;gap:2px;margin:3px 0;">${sw}</div>`+
      `<div style="display:flex;justify-content:space-between;font-size:0.72rem;color:#5b5f67;">`+
      `<span>0</span><span>${fmt(maxVal/2)}</span><span>${fmt(maxVal)}+</span></div>`;

    document.getElementById("db-map-mode-label").textContent =
      state.mode==="destination" ? "Destination Density" : "Origin Density";

    // Continent badge legend below map
    const origHex = CONT_COLORS[state.originContinent]||"#b45309";
    const destHex = CONT_COLORS[state.destContinent]||"#1d4ed8";
    contLeg.innerHTML =
      `<span class="db-cont-badge"><span class="db-cont-swatch" style="background:${origHex};opacity:0.7;"></span>${state.originContinent} (origin)</span>`+
      `<span class="db-cont-badge"><span class="db-cont-swatch" style="background:${destHex};opacity:0.7;"></span>${state.destContinent} (destination)</span>`;

    // Summary
    const top3 = Object.keys(choroplethLookup)
      .map((c)=>({c,v:choroVal(c)})).filter((x)=>x.v>0)
      .sort((a,b)=>b.v-a.v).slice(0,3);
    sumEl.textContent = top3.map((x)=>`${x.c} (${fmt(x.v)})`).join(", ");

    applyHighlights();
  }

  // ── NET FLOW ──────────────────────────────────────────────────────────────
  // Show countries from BOTH origin and destination continents, grouped/colored
  function renderNetflow() {
    if (!netflowData || !sankeyData) return;

    const svgEl = document.getElementById("db-netflow-chart");
    const sumEl = document.getElementById("db-netflow-summary");
    const corrLabel = document.getElementById("db-netflow-corridor-label");
    const svg   = d3.select(svgEl);
    svg.selectAll("*").remove();

    corrLabel.textContent = `${state.originContinent} + ${state.destContinent}`;

    const origDisplayNames = continentDisplayNames(state.originContinent);
    const destDisplayNames = continentDisplayNames(state.destContinent);
    const combinedNames = new Set([...origDisplayNames, ...destDisplayNames]);

    // Deduplicate by country name within the year
    const raw = netflowData.records.filter((r) => r.year === state.year);
    const seen = new Map();
    raw.forEach((r) => { if (!seen.has(r.country)) seen.set(r.country,r); });
    let filtered = Array.from(seen.values()).filter((r) => combinedNames.has(r.country));

    if (!filtered.length) {
      sumEl.textContent = "No data for current corridor."; return;
    }

    let bars;
    if (state.sort === "gainers")
      bars = filtered.filter((r)=>r.net>0).sort((a,b)=>b.net-a.net);
    else if (state.sort === "losers")
      bars = filtered.filter((r)=>r.net<0).sort((a,b)=>a.net-b.net);
    else
      bars = [...filtered].sort((a,b)=>Math.abs(b.net)-Math.abs(a.net));

    const vw=1400, vh=360, mL=175, mR=40, mT=28, mB=44;

    const xExtent = d3.extent(bars,(d)=>d.net);
    const xDomain = [Math.min(0,xExtent[0]), Math.max(0,xExtent[1])];
    const xScale  = d3.scaleLinear().domain(xDomain).range([mL,vw-mR]).nice();
    const yScale  = d3.scaleBand().domain(bars.map((d)=>d.country)).range([mT,vh-mB]).padding(0.2);
    const xZero   = xScale(0);

    // Gridlines
    svg.append("g").attr("transform",`translate(0,${mT})`)
      .call(d3.axisTop(xScale).ticks(8).tickSize(vh-mT-mB).tickFormat(""))
      .call((g)=>{ g.select(".domain").remove(); g.selectAll("line").attr("stroke","rgba(31,41,55,0.07)"); });

    // Continent section labels (behind everything)
    // Draw faint background bands for origin vs dest sections
    const origColor = CONT_COLORS[state.originContinent]||"#b45309";
    const destColor = CONT_COLORS[state.destContinent]||"#1d4ed8";

    bars.forEach((d) => {
      const isCont = origDisplayNames.has(d.country) ? "origin" : "dest";
      svg.append("rect")
        .attr("x",mL).attr("y",yScale(d.country))
        .attr("width",vw-mL-mR).attr("height",yScale.bandwidth())
        .attr("fill", isCont==="origin" ? origColor : destColor)
        .attr("opacity",0.04);
    });

    // Zero line
    svg.append("line")
      .attr("x1",xZero).attr("x2",xZero).attr("y1",mT).attr("y2",vh-mB)
      .attr("stroke","rgba(31,41,55,0.35)").attr("stroke-width",1.5).attr("stroke-dasharray","4,3");

    // X axis
    svg.append("g").attr("transform",`translate(0,${mT})`)
      .call(d3.axisTop(xScale).ticks(8).tickFormat(fmt))
      .call((g)=>{ g.select(".domain").remove();
        g.selectAll("text").attr("fill","#5b5f67").attr("font-size","10px");
        g.selectAll("line").attr("stroke","transparent"); });

    // Bars
    svg.append("g").selectAll("rect").data(bars).join("rect")
      .attr("data-country",(d)=>d.country)
      .attr("x",(d)=>d.net>=0 ? xZero : xScale(d.net))
      .attr("y",(d)=>yScale(d.country))
      .attr("width",(d)=>Math.max(0,Math.abs(xScale(d.net)-xZero)))
      .attr("height",yScale.bandwidth())
      .attr("fill",(d)=>d.net>=0 ? COLOR_GAIN : COLOR_LOSS)
      .attr("rx",3).attr("opacity",0.85)
      .style("cursor","pointer")
      .on("mousemove",(ev,d)=>{
        tip(ev,`<strong>${d.country}</strong><br>Net: <strong>${fmt(d.net)}</strong><br>In: ${fmt(d.inflow)} · Out: ${fmt(d.outflow)}`);
        onHover(d.country);
      })
      .on("mouseleave",()=>{ hideTip(); offHover(); })
      .on("click",(ev,d)=>toggleSel(d.country));

    // Value labels
    svg.append("g").selectAll("text").data(bars).join("text")
      .attr("x",(d)=>d.net>=0 ? xScale(d.net)+4 : xScale(d.net)-4)
      .attr("y",(d)=>yScale(d.country)+yScale.bandwidth()/2+4)
      .attr("text-anchor",(d)=>d.net>=0?"start":"end")
      .attr("fill",(d)=>d.net>=0?"#065f46":"#991b1b")
      .attr("font-size","9px").attr("font-family","Georgia,serif")
      .attr("pointer-events","none")
      .text((d)=>fmt(d.net));

    // Y axis — color labels by continent
    svg.append("g").attr("transform",`translate(${xZero},0)`)
      .call(d3.axisLeft(yScale).tickSize(0))
      .call((g)=>{
        g.select(".domain").remove();
        g.selectAll("text")
          .attr("fill",(d)=> origDisplayNames.has(d) ? origColor : destColor)
          .attr("font-weight","600")
          .attr("font-size","10px").attr("font-family","Georgia,serif")
          .attr("dx",(d)=>{ const r=bars.find((b)=>b.country===d); return r?.net>=0?"-8":"8"; })
          .attr("text-anchor",(d)=>{ const r=bars.find((b)=>b.country===d); return r?.net>=0?"end":"start"; });
      });

    // Continent legend bottom
    const legG = svg.append("g").attr("transform",`translate(${vw/2-160},${vh-mB+10})`);
    [[COLOR_GAIN,"Net gain"],[COLOR_LOSS,"Net loss"],[origColor,state.originContinent],[destColor,state.destContinent]]
      .forEach(([col,lbl],i)=>{
        const x = (i%2)*200 + Math.floor(i/2)*-5; // two cols: flow types left, continents right — actually linear
        legG.append("rect").attr("x",i*180).attr("y",0).attr("width",12).attr("height",12)
          .attr("fill",col).attr("rx",2).attr("opacity",i<2?0.85:0.5);
        legG.append("text").attr("x",i*180+18).attr("y",10)
          .attr("fill","#1f2937").attr("font-size","10px").attr("font-family","Georgia,serif").text(lbl);
      });

    const gainers=bars.filter((d)=>d.net>0).length, losers=bars.filter((d)=>d.net<0).length;
    sumEl.textContent = `${bars.length} countries (${state.originContinent} + ${state.destContinent}) — ${gainers} gaining, ${losers} losing`;

    applyHighlights();
  }

  // ── Render all ────────────────────────────────────────────────────────────
  function renderAll() {
    renderSankey();
    renderMap();
    renderNetflow();
  }

  // ── Control listeners ─────────────────────────────────────────────────────
  yearSlider.addEventListener("input",(ev)=>{
    state.year = YEARS[Number(ev.target.value)];
    yearChip.textContent = state.year;
    renderAll();
  });

  document.querySelectorAll(".gender-chip").forEach((btn)=>btn.addEventListener("click",()=>{
    document.querySelectorAll(".gender-chip").forEach((b)=>b.classList.remove("active"));
    btn.classList.add("active");
    state.gender = btn.dataset.gender;
    renderAll();
  }));

  document.querySelectorAll(".mode-chip").forEach((btn)=>btn.addEventListener("click",()=>{
    document.querySelectorAll(".mode-chip").forEach((b)=>b.classList.remove("active"));
    btn.classList.add("active");
    state.mode = btn.dataset.mode;
    renderAll();
  }));

  document.querySelectorAll(".sort-chip").forEach((btn)=>btn.addEventListener("click",()=>{
    document.querySelectorAll(".sort-chip").forEach((b)=>b.classList.remove("active"));
    btn.classList.add("active");
    state.sort = btn.dataset.sort;
    renderNetflow();
  }));

  origSel.addEventListener("change",(ev)=>{
    state.originContinent = ev.target.value;
    renderAll();
  });

  destSel.addEventListener("change",(ev)=>{
    state.destContinent = ev.target.value;
    renderAll();
  });

  clearBtn.addEventListener("click",()=>{
    state.selected.clear();
    updateSelUI();
    applyHighlights();
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    try {
      const [sr, cr, nr, tr] = await Promise.all([
        fetch(SANKEY_EP), fetch(CHOROPLETH_EP), fetch(NETFLOW_EP),
        fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"),
      ]);
      if (!sr.ok||!cr.ok||!nr.ok||!tr.ok)
        throw new Error(`Fetch failed: sankey=${sr.status} choro=${cr.status} netflow=${nr.status} topo=${tr.status}`);

      sankeyData      = await sr.json();
      choroplethData  = await cr.json();
      netflowData     = await nr.json();
      const topoData  = await tr.json();

      // Patch topo with readable names
      const namesR = await fetch("https://cdn.jsdelivr.net/gh/mledoze/countries@master/countries.json").catch(()=>null);
      if (namesR?.ok) {
        const cj = await namesR.json();
        const n2n = {};
        cj.forEach((c)=>{ if(c.ccn3&&c.name?.common) n2n[parseInt(c.ccn3,10)]=c.name.common; });
        topoData.objects.countries.geometries.forEach((g)=>{
          if(!g.properties) g.properties={};
          g.properties.name = n2n[g.id]||g.properties.name||String(g.id);
        });
      }

      geoFeatures = topojson.feature(topoData, topoData.objects.countries).features;

      // Build choropleth lookup
      choroplethData.records.forEach((r)=>{
        if(!choroplethLookup[r.country]) choroplethLookup[r.country]={};
        choroplethLookup[r.country][r.year]=r;
      });
      Object.keys(choroplethLookup).forEach((n)=>{ choroplethNormLookup[normName(n)]=n; });

      if (choroplethData.top_partners) {
        Object.entries(choroplethData.top_partners).forEach(([raw,yd])=>{
          topPartnersLookup[normName(raw)]=yd;
        });
      }

      // Build continent raw name sets
      buildContinentRawNames();

      // Build country->continent display map
      Object.entries(sankeyData.continent_countries).forEach(([cont,rawList])=>{
        rawList.forEach((r)=>{
          const lbl = sankeyData.country_meta[r]?.label||r;
          countryToContinent[lbl]=cont;
        });
      });

      // Populate continent dropdowns
      const conts = Object.keys(sankeyData.continent_countries);
      [origSel, destSel].forEach((sel,i)=>{
        sel.innerHTML="";
        const def = i===0 ? state.originContinent : state.destContinent;
        conts.forEach((c)=>{
          const o=document.createElement("option");
          o.value=c; o.textContent=c;
          if(c===def) o.selected=true;
          sel.appendChild(o);
        });
      });

      yearSlider.max   = String(YEARS.length-1);
      yearSlider.value = String(YEARS.length-1);

      renderAll();
    } catch(err) {
      console.error("Dashboard init error:", err);
      ["db-sankey-summary","db-map-summary","db-netflow-summary"].forEach((id)=>{
        const el=document.getElementById(id);
        if(el) el.textContent = `Failed: ${err.message}`;
      });
    }
  }

  init();
})();
