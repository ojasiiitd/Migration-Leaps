(function () {
  /* ── Dual-axis time series: migrants (bars) + % of population (line) ── */
  function renderDualAxis() {
    const container = document.getElementById("dual-axis-chart");
    if (!container || !window.__GLOBAL_TREND__) return;

    const raw = window.__GLOBAL_TREND__;
    // Only include years where we have migrant data (snapshot years)
    const snapYears = raw.filter((d) => d.migrants !== null);

    const margin = { top: 30, right: 80, bottom: 48, left: 80 };
    const totalW = container.clientWidth || 900;
    const totalH = 340;
    const W = totalW - margin.left - margin.right;
    const H = totalH - margin.top - margin.bottom;

    const svg = d3
      .select(container)
      .append("svg")
      .attr("viewBox", `0 0 ${totalW} ${totalH}`)
      .attr("width", "100%")
      .attr("height", totalH);

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleBand()
      .domain(snapYears.map((d) => d.year))
      .range([0, W])
      .padding(0.28);

    const maxMigrants = d3.max(snapYears, (d) => d.migrants);
    const yLeft = d3.scaleLinear().domain([0, maxMigrants * 1.1]).range([H, 0]);

    const maxPct = d3.max(snapYears, (d) => d.pct);
    const yRight = d3.scaleLinear().domain([0, maxPct * 1.15]).range([H, 0]);

    // Gridlines
    g.append("g")
      .call(d3.axisLeft(yLeft).ticks(5).tickSize(-W).tickFormat(""))
      .call((ax) => {
        ax.select(".domain").remove();
        ax.selectAll("line").attr("stroke", "rgba(31,41,55,0.07)");
      });

    // Bars — migrants in millions, soft blue/purple
    g.append("g")
      .selectAll("rect")
      .data(snapYears)
      .join("rect")
      .attr("x", (d) => xScale(d.year))
      .attr("y", (d) => yLeft(d.migrants))
      .attr("width", xScale.bandwidth())
      .attr("height", (d) => H - yLeft(d.migrants))
      .attr("fill", "#7c9fd4")
      .attr("rx", 4)
      .attr("opacity", 0.82);

    // Value labels on bars
    g.append("g")
      .selectAll("text")
      .data(snapYears)
      .join("text")
      .attr("x", (d) => xScale(d.year) + xScale.bandwidth() / 2)
      .attr("y", (d) => yLeft(d.migrants) - 6)
      .attr("text-anchor", "middle")
      .attr("fill", "#374151")
      .attr("font-size", "11px")
      .attr("font-family", "Georgia, serif")
      .text((d) => `${(d.migrants / 1e6).toFixed(0)}M`);

    // Line — % of population, dark green
    const lineGen = d3
      .line()
      .x((d) => xScale(d.year) + xScale.bandwidth() / 2)
      .y((d) => yRight(d.pct))
      .curve(d3.curveCatmullRom.alpha(0.5));

    g.append("path")
      .datum(snapYears)
      .attr("fill", "none")
      .attr("stroke", "#166534")
      .attr("stroke-width", 2.6)
      .attr("d", lineGen);

    // Dots on line
    g.append("g")
      .selectAll("circle")
      .data(snapYears)
      .join("circle")
      .attr("cx", (d) => xScale(d.year) + xScale.bandwidth() / 2)
      .attr("cy", (d) => yRight(d.pct))
      .attr("r", 4.5)
      .attr("fill", "#166534")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5);

    // Pct labels on line
    g.append("g")
      .selectAll("text")
      .data(snapYears)
      .join("text")
      .attr("x", (d) => xScale(d.year) + xScale.bandwidth() / 2)
      .attr("y", (d) => yRight(d.pct) - 10)
      .attr("text-anchor", "middle")
      .attr("fill", "#166534")
      .attr("font-size", "10px")
      .attr("font-family", "Georgia, serif")
      .text((d) => `${d.pct}%`);

    // X axis
    g.append("g")
      .attr("transform", `translate(0,${H})`)
      .call(d3.axisBottom(xScale).tickSize(0))
      .call((ax) => {
        ax.select(".domain").attr("stroke", "rgba(31,41,55,0.15)");
        ax.selectAll("text").attr("fill", "#5b5f67").attr("font-size", "12px").attr("font-family", "Georgia, serif");
      });

    // Left Y axis
    g.append("g")
      .call(d3.axisLeft(yLeft).ticks(5).tickFormat((d) => `${(d / 1e6).toFixed(0)}M`))
      .call((ax) => {
        ax.select(".domain").remove();
        ax.selectAll("text").attr("fill", "#7c9fd4").attr("font-size", "11px");
      });

    // Left axis label
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -H / 2)
      .attr("y", -62)
      .attr("text-anchor", "middle")
      .attr("fill", "#7c9fd4")
      .attr("font-size", "12px")
      .attr("font-family", "Georgia, serif")
      .text("Millions");

    // Right Y axis
    g.append("g")
      .attr("transform", `translate(${W},0)`)
      .call(d3.axisRight(yRight).ticks(5).tickFormat((d) => `${d.toFixed(1)}%`))
      .call((ax) => {
        ax.select(".domain").remove();
        ax.selectAll("text").attr("fill", "#166534").attr("font-size", "11px");
      });

    // Right axis label
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -H / 2)
      .attr("y", W + 68)
      .attr("text-anchor", "middle")
      .attr("fill", "#166534")
      .attr("font-size", "12px")
      .attr("font-family", "Georgia, serif")
      .text("Percentage");

    // Legend
    const legendG = g.append("g").attr("transform", `translate(${W / 2 - 130}, ${H + 34})`);
    legendG.append("rect").attr("width", 18).attr("height", 12).attr("fill", "#7c9fd4").attr("rx", 3).attr("opacity", 0.82);
    legendG.append("text").attr("x", 24).attr("y", 10).attr("fill", "#374151").attr("font-size", "11px").attr("font-family", "Georgia, serif").text("International migrants (millions)");
    legendG.append("line").attr("x1", 220).attr("x2", 238).attr("y1", 6).attr("y2", 6).attr("stroke", "#166534").attr("stroke-width", 2.6);
    legendG.append("circle").attr("cx", 229).attr("cy", 6).attr("r", 4).attr("fill", "#166534");
    legendG.append("text").attr("x", 244).attr("y", 10).attr("fill", "#374151").attr("font-size", "11px").attr("font-family", "Georgia, serif").text("Share of global population (%)");
  }

  /* ── Horizontal dot plot: 12 leading destination countries ── */
  function renderDotPlot() {
    const container = document.getElementById("dot-plot-chart");
    if (!container || !window.__LEADING_DEST__) return;

    const { countries, years } = window.__LEADING_DEST__;

    const yearColors = {
      "1990": "#bfdbfe",
      "2000": "#93c5fd",
      "2010": "#60a5fa",
      "2020": "#2563eb",
      "2024": "#1e3a8a",
    };
    const yearMarker = {
      "1990": "circle",
      "2000": "circle",
      "2010": "circle",
      "2020": "circle",
      "2024": "square",
    };

    const margin = { top: 20, right: 200, bottom: 40, left: 220 };
    const totalW = container.clientWidth || 900;
    const rowH = 42;
    const totalH = countries.length * rowH + margin.top + margin.bottom;
    const W = totalW - margin.left - margin.right;
    const H = totalH - margin.top - margin.bottom;

    const svg = d3
      .select(container)
      .append("svg")
      .attr("viewBox", `0 0 ${totalW} ${totalH}`)
      .attr("width", "100%")
      .attr("height", totalH);

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const allVals = countries.flatMap((c) => Object.values(c.values));
    const xScale = d3.scaleLinear().domain([0, Math.ceil(d3.max(allVals) * 1.05)]).range([0, W]).nice();

    const yScale = d3
      .scaleBand()
      .domain(countries.map((c) => c.country))
      .range([0, H])
      .padding(0.3);

    // Gridlines
    g.append("g")
      .call(d3.axisBottom(xScale).ticks(7).tickSize(H).tickFormat(""))
      .call((ax) => {
        ax.select(".domain").remove();
        ax.selectAll("line").attr("stroke", "rgba(31,41,55,0.07)");
      });

    // Connecting lines per country
    countries.forEach((country) => {
      const vals = years.map((y) => ({ year: y, val: country.values[y] }));
      const minVal = d3.min(vals, (d) => d.val);
      const maxVal = d3.max(vals, (d) => d.val);
      const cy = yScale(country.country) + yScale.bandwidth() / 2;

      g.append("line")
        .attr("x1", xScale(minVal))
        .attr("x2", xScale(maxVal))
        .attr("y1", cy)
        .attr("y2", cy)
        .attr("stroke", "#d1d5db")
        .attr("stroke-width", 1.5);
    });

    // Dots per year
    years.forEach((year) => {
      const color = yearColors[year];
      const isSquare = yearMarker[year] === "square";

      countries.forEach((country) => {
        const cx = xScale(country.values[year]);
        const cy = yScale(country.country) + yScale.bandwidth() / 2;
        const r = 6;

        if (isSquare) {
          g.append("rect")
            .attr("x", cx - r)
            .attr("y", cy - r)
            .attr("width", r * 2)
            .attr("height", r * 2)
            .attr("fill", color)
            .attr("stroke", "#fff")
            .attr("stroke-width", 1);
        } else {
          g.append("circle")
            .attr("cx", cx)
            .attr("cy", cy)
            .attr("r", r)
            .attr("fill", color)
            .attr("stroke", "#fff")
            .attr("stroke-width", 1);
        }
      });
    });

    // Value label for 2024 (rightmost)
    countries.forEach((country) => {
      const val = country.values["2024"];
      const cx = xScale(val);
      const cy = yScale(country.country) + yScale.bandwidth() / 2;
      g.append("text")
        .attr("x", cx + 10)
        .attr("y", cy + 4)
        .attr("fill", "#1e3a8a")
        .attr("font-size", "10px")
        .attr("font-family", "Georgia, serif")
        .text(`${val}M`);
    });

    // Y axis (country labels)
    g.append("g")
      .call(d3.axisLeft(yScale).tickSize(0))
      .call((ax) => {
        ax.select(".domain").remove();
        ax.selectAll("text")
          .attr("fill", "#1f2937")
          .attr("font-size", "12px")
          .attr("font-family", "Georgia, serif")
          .attr("dx", "-8");
      });

    // X axis
    g.append("g")
      .attr("transform", `translate(0,${H})`)
      .call(d3.axisBottom(xScale).ticks(7).tickFormat((d) => `${d}M`))
      .call((ax) => {
        ax.select(".domain").attr("stroke", "rgba(31,41,55,0.15)");
        ax.selectAll("text").attr("fill", "#5b5f67").attr("font-size", "11px").attr("font-family", "Georgia, serif");
      });

    // Legend (right side)
    const legendG = svg.append("g").attr("transform", `translate(${totalW - margin.right + 20}, ${margin.top + 20})`);
    legendG.append("text")
      .attr("x", 0).attr("y", 0)
      .attr("fill", "#5b5f67").attr("font-size", "11px").attr("font-family", "Georgia, serif")
      .attr("font-weight", "bold")
      .text("Year");

    years.forEach((year, i) => {
      const color = yearColors[year];
      const isSquare = yearMarker[year] === "square";
      const ly = 20 + i * 24;

      if (isSquare) {
        legendG.append("rect").attr("x", 0).attr("y", ly - 6).attr("width", 12).attr("height", 12).attr("fill", color).attr("stroke", "#fff").attr("stroke-width", 0.5);
      } else {
        legendG.append("circle").attr("cx", 6).attr("cy", ly).attr("r", 6).attr("fill", color).attr("stroke", "#fff").attr("stroke-width", 0.5);
      }
      legendG.append("text").attr("x", 18).attr("y", ly + 4).attr("fill", "#374151").attr("font-size", "11px").attr("font-family", "Georgia, serif").text(year);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      renderDualAxis();
      renderDotPlot();
    });
  } else {
    renderDualAxis();
    renderDotPlot();
  }
})();
