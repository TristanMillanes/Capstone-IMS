/* Chart presentation shared by both office dashboards. */
(() => {
  "use strict";

  const distributionShare = new Intl.NumberFormat("en-PH", { style: "percent", maximumFractionDigits: 1 });
  const chartTheme = () => document.documentElement.dataset.theme === "dark"
    ? { text: "#a5c1b1", grid: "#25483c", surface: "#102a23", total: "#ecf8f0", tip: "#091c17" }
    : { text: "#627e70", grid: "#dfeae4", surface: "#ffffff", total: "#163b2e", tip: "#065f46" };

  let chartTooltip = null, chartTooltipOwner = null, chartTooltipContent = "", touchSelectionChart = null;
  function hideChartTooltip() {
    if (chartTooltip) chartTooltip.hidden = true;
    chartTooltipOwner = null; touchSelectionChart = null;
  }

  // Use one tooltip so chart panels and scrollers cannot clip it.
  // Use the canvas's displayed size, not its retina bitmap or page scroll offsets.
  function renderChartTooltip({ chart, tooltip }) {
    if (!tooltip.opacity || !tooltip.dataPoints?.length) {
      if (chartTooltipOwner === chart) hideChartTooltip();
      return;
    }
    if (!chartTooltip) {
      chartTooltip = document.createElement("div");
      chartTooltip.className = "analytics-pointer-tooltip";
      chartTooltip.id = "analyticsPointerTooltip";
      chartTooltip.setAttribute("role", "tooltip");
      document.body.appendChild(chartTooltip);
    }
    const rows = tooltip.dataPoints.map((point, index) => {
      const parsed = point.parsed;
      const value = chart.config.type === "doughnut" ? parsed
        : chart.options.indexAxis === "y" ? parsed.x : parsed.y;
      const colors = tooltip.labelColors[index];
      const color = chart.config.type === "line" ? colors?.borderColor : colors?.backgroundColor;
      return { label: point.dataset.label || point.label, value: Number(value || 0).toLocaleString("en-PH"), color };
    });
    const title = (tooltip.title || []).join(" ");
    const content = JSON.stringify([chart.canvas.id, title, rows]);
    if (content !== chartTooltipContent) {
      const heading = document.createElement("strong");
      heading.className = "analytics-tooltip-title"; heading.textContent = title;
      const items = rows.map(row => {
        const item = document.createElement("div"), swatch = document.createElement("i");
        const label = document.createElement("span"), count = document.createElement("strong");
        item.className = "analytics-tooltip-row"; swatch.setAttribute("aria-hidden", "true");
        swatch.style.backgroundColor = typeof row.color === "string" ? row.color : "#278560";
        label.textContent = row.label; count.textContent = row.value;
        item.append(swatch, label, count); return item;
      });
      chartTooltip.replaceChildren(heading, ...items); chartTooltipContent = content;
    }
    chartTooltipOwner = chart; chartTooltip.hidden = false;
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width || innerWidth, viewportHeight = viewport?.height || innerHeight;
    const currentBox = chartTooltip.getBoundingClientRect(), style = getComputedStyle(chartTooltip);
    const scaleX = currentBox.width / parseFloat(style.width) || 1;
    const scaleY = currentBox.height / parseFloat(style.height) || 1;
    chartTooltip.style.maxWidth = `${Math.max(1, Math.min(320, viewportWidth - 24)) / scaleX}px`;
    chartTooltip.style.maxHeight = `${Math.max(1, viewportHeight - 16) / scaleY}px`;
    const rect = chart.canvas.getBoundingClientRect();
    const anchorX = rect.left + tooltip.caretX * rect.width / chart.width;
    const anchorY = rect.top + tooltip.caretY * rect.height / chart.height;
    const leftEdge = (viewport?.offsetLeft || 0) + 8, topEdge = (viewport?.offsetTop || 0) + 8;
    const rightEdge = leftEdge + viewportWidth - 16;
    const bottomEdge = topEdge + viewportHeight - 16;
    const box = chartTooltip.getBoundingClientRect(), width = box.width, height = box.height;
    const left = anchorX + 12 + width <= rightEdge ? anchorX + 12 : anchorX - width - 12;
    const top = anchorY + 12 + height <= bottomEdge ? anchorY + 12 : anchorY - height - 12;
    chartTooltip.style.left = `${Math.max(leftEdge, Math.min(left, rightEdge - width)) / scaleX}px`;
    chartTooltip.style.top = `${Math.max(topEdge, Math.min(top, bottomEdge - height)) / scaleY}px`;
  }
  // A scroll can move a canvas without a mouse event. Hide the old information
  // immediately; the next pointer/touch event computes fresh coordinates.
  document.addEventListener("scroll", hideChartTooltip, { capture: true, passive: true });
  window.addEventListener("resize", hideChartTooltip, { passive: true });
  window.visualViewport?.addEventListener("resize", hideChartTooltip, { passive: true });
  window.visualViewport?.addEventListener("scroll", hideChartTooltip, { passive: true });
  document.addEventListener("pointermove", event => {
    if (event.pointerType === "mouse") {
      touchSelectionChart = null;
      if (chartTooltipOwner && event.target !== chartTooltipOwner.canvas) hideChartTooltip();
    }
  }, { passive: true });
  document.addEventListener("pointerdown", event => {
    if (chartTooltipOwner && event.target !== chartTooltipOwner.canvas) hideChartTooltip();
  }, { passive: true });
  document.addEventListener("keydown", event => { if (event.key === "Escape") hideChartTooltip(); });

  const chartPointerCoordinates = {
    id: "pgenroPointerCoordinates",
    beforeEvent(chart, args) {
      const { event } = args;
      // Touch taps can emit a synthetic mouseout immediately afterwards. Keep
      // their selection until another tap, a real mouse move, scroll or Escape.
      if (event.type === "mouseout") return touchSelectionChart === chart ? false : undefined;
      const native = event.native, pointer = native?.touches?.[0] || native?.changedTouches?.[0] || native;
      if (native?.type?.startsWith("touch")) touchSelectionChart = chart;
      if (!Number.isFinite(pointer?.clientX) || !Number.isFinite(pointer?.clientY)) return;
      const rect = chart.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // offsetX/offsetY can use different units under CSS zoom. Normalize both
      // hit testing and tooltip anchoring from the same visible canvas rectangle.
      event.x = (pointer.clientX - rect.left) * chart.width / rect.width;
      event.y = (pointer.clientY - rect.top) * chart.height / rect.height;
      args.inChartArea = chart.isPointInArea(event);
    }
  };

  const doughnutTotal = {
    id: "pgenroDoughnutTotal",
    afterDraw(chart) {
      if (chart.config.type !== "doughnut" || !chart.chartArea) return;
      const arc = chart.getDatasetMeta(0).data[0];
      if (!arc || arc.innerRadius < 28) return;
      const total = chart.data.datasets[0].data.reduce((sum, n, i) =>
        sum + (chart.getDataVisibility(i) ? Number(n) || 0 : 0), 0);
      const ctx = chart.ctx, theme = chartTheme();
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = theme.total;
      ctx.font = `750 ${Math.min(31, arc.innerRadius * .49)}px Inter, system-ui, sans-serif`;
      ctx.fillText(new Intl.NumberFormat("en-PH", { notation: total >= 10000 ? "compact" : "standard" }).format(total), arc.x, arc.y - 6);
      ctx.fillStyle = theme.text; ctx.font = "600 9px Inter, system-ui, sans-serif";
      const filtered = chart.data.labels.some((_, index) => !chart.getDataVisibility(index));
      ctx.fillText(filtered ? "VISIBLE RECORDS" : "TOTAL RECORDS", arc.x, arc.y + 17); ctx.restore();
    }
  };

  function chartOptions({ horizontal = false, doughnut = false, legend = false } = {}) {
    const theme = chartTheme();
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const labelSize = Math.max(13, Math.round(rootFontSize * .8125));
    // Fresh nested options for every instance prevent Chart.js mutation leaking across charts.
    const result = {
      responsive: true, maintainAspectRatio: false, resizeDelay: 0,
      animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 220 },
      font: { family: "Inter, system-ui, sans-serif" },
      interaction: { mode: doughnut ? "nearest" : "index", intersect: doughnut, axis: doughnut ? "xy" : horizontal ? "y" : "x" },
      layout: { padding: { top: 8, bottom: 2, left: 0, right: 8 } },
      plugins: {
        legend: { display: legend, position: "bottom", labels: { color: theme.text, usePointStyle: true, pointStyle: "circle", boxWidth: 7, boxHeight: 7, padding: 13, font: { family: "Inter, system-ui, sans-serif", size: labelSize } } },
        tooltip: { enabled: false, external: renderChartTooltip, position: "pgenroPointer", animation: false, animations: false,
          backgroundColor: theme.tip, titleColor: "#fff", bodyColor: "#ddefe4", padding: 12, cornerRadius: 10, displayColors: true,
          callbacks: { label(context) {
            const value = doughnut ? context.parsed : horizontal ? context.parsed.x : context.parsed.y;
            return `${context.dataset.label || context.label}: ${Number(value || 0).toLocaleString("en-PH")}`;
          } }
        }
      }
    };
    if (doughnut) { result.cutout = "74%"; return result; }
    result.indexAxis = horizontal ? "y" : "x";
    const numbers = { beginAtZero: true, suggestedMax: 1, border: { display: false }, grid: { color: theme.grid, drawTicks: false }, ticks: { precision: 0, padding: 8, color: theme.text, font: { size: labelSize } } };
    const labels = { border: { display: false }, grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0, maxTicksLimit: horizontal ? 24 : 8, padding: 8, color: theme.text, font: { size: labelSize } } };
    result.scales = horizontal ? { x: numbers, y: labels } : { x: labels, y: numbers };
    return result;
  }

  function lineArea(context) {
    const { chart } = context, area = chart.chartArea;
    if (!area) return "#05966918";
    const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    gradient.addColorStop(0, "#05966936"); gradient.addColorStop(1, "#05966900"); return gradient;
  }

  function assertDistributionColors(chart) {
    const { data, backgroundColor } = chart.data.datasets[0];
    const arcs = chart.getDatasetMeta(0).data;
    if (data.some((value, index) => value > 0 && arcs[index]?.options?.backgroundColor !== backgroundColor[index])) {
      throw new Error("Chart did not apply the category colors.");
    }
  }

  const positioners = window.Chart?.Tooltip?.positioners;
  if (positioners) {
    // The default average position lands between line series or at a bar end.
    // Anchor the information to the actual event, with no animation lag.
    positioners.pgenroPointer = function(elements, position) {
      if (!elements.length || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return false;
      return { x: position.x, y: position.y };
    };
  }

  // Keep exact counts and shares readable even when the canvas is unavailable.
  function renderChartLegend(legend, chart, categories) {
    if (!legend) return;
    const total = categories.reduce((sum, category) => sum + (category.value ?? 0), 0);
    legend.hidden = total === 0;
    if (legend.hidden) { legend.replaceChildren(); return; }
    legend.replaceChildren(...categories.map(({ label, value, color }, index) => {
      const interactive = chart && value !== null;
      const item = document.createElement(interactive ? "button" : "div");
      const swatch = document.createElement("i");
      const copy = document.createElement("span");
      const name = document.createElement("span");
      const share = document.createElement("small");
      item.className = "analytics-legend-item";
      swatch.style.backgroundColor = color;
      swatch.setAttribute("aria-hidden", "true");
      copy.className = "analytics-legend-copy";
      name.textContent = label;
      share.textContent = value === null ? "Data unavailable" : `${distributionShare.format(value / total)} of records`;
      copy.append(name, share);
      item.append(swatch, copy);
      if (value !== null) {
        const count = document.createElement("strong");
        count.textContent = value.toLocaleString("en-PH");
        item.append(count);
      }
      if (interactive) {
        item.type = "button";
        const updatePressed = () => item.setAttribute("aria-pressed", String(chart.getDataVisibility(index)));
        updatePressed();
        item.addEventListener("click", () => {
          hideChartTooltip();
          chart.toggleDataVisibility(index);
          chart.update("none");
          updatePressed();
        });
      }
      return item;
    }));
  }

  window.PGENRO_DashboardCharts = Object.freeze({
    chartTheme, chartOptions, chartPointerCoordinates, doughnutTotal, lineArea,
    hideChartTooltip, renderChartLegend, assertDistributionColors, distributionShare
  });
})();
