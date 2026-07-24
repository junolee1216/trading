const data = window.KR_STOCK_DATA;
const engine = window.AnalysisEngine;
const stockUniverse = window.KR_STOCK_UNIVERSE || data.stocks.map((stock) => ({
  code: stock.code,
  name: stock.name,
  market: stock.market,
  sector: stock.sector || "",
  industry: ""
}));
const stockSearchRank = window.KR_STOCK_SEARCH_RANK || {};

const state = {
  selectedCode: data.stocks[0].code,
  mode: "balanced",
  chartInterval: "D",
  chartRange: "all",
  chartOffset: 0,
  chartStyle: "candle",
  showMa: true,
  showSignals: true,
  activeDrawingTool: "cursor",
  chartAnnotations: {},
  chartRedoStack: {},
  currentChartLength: 60,
  watchlist: JSON.parse(localStorage.getItem("kr-watchlist") || "[]"),
  collapsedPanels: JSON.parse(localStorage.getItem("kr-collapsed-panels") || "[]")
};

const $ = (id) => document.getElementById(id);
const formatWon = (value) => `${value.toLocaleString()}원`;
const formatNullable = (value, suffix = "") => (value === null || value === undefined ? "연결 필요" : `${value}${suffix}`);
const percentClass = (value) => (value > 0 ? "positive" : value < 0 ? "negative" : "neutral");
const getStock = () => data.stocks.find((stock) => stock.code === state.selectedCode) || data.stocks[0];
const getStockEntry = (code) => stockUniverse.find((stock) => stock.code === code) || data.stocks.find((stock) => stock.code === code);
const compactText = (value = "") => String(value).toLowerCase().replace(/\s+/g, "");
const tradingViewSymbol = (code) => `KRX:${String(code).padStart(6, "0")}`;
const dynamicStockCache = new Map();
const dynamicStockRequests = new Map();
let tradingViewRenderId = 0;
let activeDraftAnnotation = null;
let activePan = null;
let chartClockTimer = null;

function renderTradingViewChart(entry) {
  const container = $("tradingview-chart");
  if (!container || !entry?.code) return;
  const renderId = tradingViewRenderId + 1;
  tradingViewRenderId = renderId;
  const symbol = tradingViewSymbol(entry.code);

  const now = currentSeoulTime();
  const intervalButtons = [
    ["1", "1분"],
    ["30", "30분"],
    ["60", "1시간"],
    ["D", "일"]
  ];
  const drawingTools = [
    ["cursor", "↖"],
    ["line", "/"],
    ["brush", "⌁"],
    ["text", "T"],
    ["undo", "↶"],
    ["redo", "↷"]
  ];

  container.innerHTML = `
    <div class="tradingview-status">
      <span>${entry.name || entry.code} · ${symbol}</span>
      <span class="chart-mode-status">${currentChartModeText()}</span>
    </div>
    <div class="chart-toolbar" aria-label="차트 도구">
      ${intervalButtons.map(([value, label]) => `<button class="chart-tool ${state.chartInterval === value ? "active" : ""}" type="button" data-chart-interval="${value}">${label}</button>`).join("")}
      <span class="chart-divider"></span>
      <button class="chart-tool ${state.chartStyle === "candle" ? "active" : ""}" type="button" data-chart-style="candle">캔들</button>
      <button class="chart-tool ${state.chartStyle === "line" ? "active" : ""}" type="button" data-chart-style="line">라인</button>
      <span class="chart-divider"></span>
      <button class="chart-tool ${state.showMa ? "active" : ""}" type="button" data-chart-toggle="ma">20일선</button>
      <button class="chart-tool ${state.showSignals ? "active" : ""}" type="button" data-chart-toggle="signals">신호</button>
      <button class="chart-tool" type="button" data-chart-action="snapshot">저장</button>
    </div>
    <div class="chart-workspace">
      <div class="chart-drawing-tools" aria-label="보조 도구">
        ${drawingTools.map(([tool, label]) => `<button class="${state.activeDrawingTool === tool ? "active" : ""}" type="button" data-chart-tool="${tool}" aria-label="${chartToolLabel(tool)}">${label}</button>`).join("")}
      </div>
      <div class="chart-canvas-shell ${state.activeDrawingTool !== "cursor" ? "is-drawing-tool" : ""}" id="chart-canvas-shell">
        <canvas id="tradingview-local-chart" class="tradingview-local-chart" width="1100" height="486"></canvas>
        <svg id="chart-annotation-layer" class="chart-annotation-layer" aria-label="차트 주석 레이어"></svg>
        <div id="chart-text-layer" class="chart-text-layer"></div>
      </div>
      <aside id="chart-info-panel" class="chart-info-panel"></aside>
    </div>
    <div class="chart-range-bar">
      <span class="chart-visible-range">표시 구간: ${chartRangeLabel()}</span>
      <span id="chart-clock">${now} UTC+9</span>
      <span class="chart-zoom-hint">차트 위에서 휠: 확대/축소</span>
    </div>`;
  bindChartControls();
  bindAnnotationLayer();
  renderChartAnnotations();
  startChartClock();
}

function currentSeoulTime() {
  return new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function updateChartClock() {
  const clock = $("chart-clock");
  if (clock) clock.textContent = `${currentSeoulTime()} UTC+9`;
}

function startChartClock() {
  updateChartClock();
  if (chartClockTimer) return;
  chartClockTimer = window.setInterval(updateChartClock, 1000);
}

function intervalLabel(value) {
  return {
    "1": "1분",
    "30": "30분",
    "60": "1시간",
    D: "일"
  }[value] || "일";
}

function chartToolLabel(value) {
  return {
    cursor: "일반 마우스",
    line: "직선 그리기",
    brush: "자유 그리기",
    text: "텍스트박스",
    undo: "되돌리기",
    redo: "다시하기"
  }[value] || "보조 도구";
}

function chartStyleLabel(value) {
  return value === "line" ? "라인" : "캔들";
}

function currentChartModeText() {
  return `${intervalLabel(state.chartInterval)} · ${chartStyleLabel(state.chartStyle)} · ${chartToolLabel(state.activeDrawingTool)}`;
}

function chartRangeLabel() {
  return state.chartRange === "all" ? "전체" : `${state.chartRange}일`;
}

function isFullyZoomedOut() {
  return state.chartRange === "all";
}

function intervalDefaultRange(value) {
  if (value === "1") return "20";
  if (value === "30") return "30";
  if (value === "60") return "40";
  return "all";
}

function chartRangeCount(total = state.currentChartLength || 60) {
  return state.chartRange === "all" ? total : Math.min(total, Number(state.chartRange) || total);
}

function clampChartOffset(offset = state.chartOffset, total = state.currentChartLength || 60, range = chartRangeCount(total)) {
  if (range >= total) return 0;
  return Math.max(0, Math.min(total - range, Math.round(offset)));
}

function setChartRangeAndOffset(range, offset = state.chartOffset) {
  const total = state.currentChartLength || 60;
  const nextRange = range >= total ? total : Math.max(12, Math.min(total, Math.round(range)));
  state.chartRange = nextRange >= total ? "all" : String(nextRange);
  state.chartOffset = clampChartOffset(offset, total, nextRange);
}

function bindChartControls() {
  document.querySelectorAll("[data-chart-interval]").forEach((button) => {
    button.addEventListener("click", () => {
      state.chartInterval = button.dataset.chartInterval;
      state.chartRange = intervalDefaultRange(state.chartInterval);
      state.chartOffset = 0;
      render();
    });
  });
  document.querySelectorAll("[data-chart-style]").forEach((button) => {
    button.addEventListener("click", () => {
      state.chartStyle = button.dataset.chartStyle;
      render();
    });
  });
  document.querySelectorAll("[data-chart-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.chartToggle === "ma") state.showMa = !state.showMa;
      if (button.dataset.chartToggle === "signals") state.showSignals = !state.showSignals;
      render();
    });
  });
  document.querySelectorAll("[data-chart-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      const tool = button.dataset.chartTool;
      if (tool === "undo") {
        undoChartAnnotation();
        return;
      }
      if (tool === "redo") {
        redoChartAnnotation();
        return;
      }
      state.activeDrawingTool = tool;
      render();
    });
  });
  document.querySelector("[data-chart-action='snapshot']")?.addEventListener("click", () => {
    const canvas = $("tradingview-local-chart");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${state.selectedCode}-chart.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  });
}

function getCurrentAnnotations() {
  if (!state.chartAnnotations[state.selectedCode]) state.chartAnnotations[state.selectedCode] = [];
  return state.chartAnnotations[state.selectedCode];
}

function getCurrentRedoStack() {
  if (!state.chartRedoStack[state.selectedCode]) state.chartRedoStack[state.selectedCode] = [];
  return state.chartRedoStack[state.selectedCode];
}

function addChartAnnotation(annotation) {
  getCurrentAnnotations().push(annotation);
  state.chartRedoStack[state.selectedCode] = [];
}

function undoChartAnnotation() {
  const annotations = getCurrentAnnotations();
  const removed = annotations.pop();
  if (removed) getCurrentRedoStack().push(removed);
  renderChartAnnotations();
}

function redoChartAnnotation() {
  const restored = getCurrentRedoStack().pop();
  if (restored) getCurrentAnnotations().push(restored);
  renderChartAnnotations();
}

function updateDrawingToolUi() {
  document.querySelectorAll("[data-chart-tool]").forEach((button) => {
    const tool = button.dataset.chartTool;
    button.classList.toggle("active", tool === state.activeDrawingTool && tool !== "undo" && tool !== "redo");
  });
  const status = document.querySelector(".chart-mode-status");
  if (status) status.textContent = currentChartModeText();
  const shell = $("chart-canvas-shell");
  if (shell) shell.classList.toggle("is-drawing-tool", state.activeDrawingTool !== "cursor");
}

function getCurrentRenderableStock() {
  return data.stocks.find((item) => item.code === state.selectedCode) || dynamicStockCache.get(state.selectedCode) || getStock();
}

function refreshChartOnly() {
  const stock = getCurrentRenderableStock();
  if (!stock?.prices?.length) return;
  const analysis = engine.analyze(stock, data.market, state.mode);
  drawChart(stock, analysis, "tradingview-local-chart");
  const range = document.querySelector(".chart-visible-range");
  if (range) range.textContent = `표시 구간: ${chartRangeLabel()}`;
  renderChartAnnotations();
}

function getLayerPoint(event) {
  const shell = $("chart-canvas-shell");
  if (!shell) return { x: 0, y: 0 };
  const rect = shell.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
  };
}

function bindAnnotationLayer() {
  const shell = $("chart-canvas-shell");
  if (!shell || shell.dataset.annotationReady) return;
  shell.dataset.annotationReady = "true";

  shell.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomChartByWheel(event.deltaY);
  }, { passive: false });

  shell.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".chart-text-note")) return;
    const tool = state.activeDrawingTool;
    const point = getLayerPoint(event);
    if (tool === "cursor") {
      if (state.chartRange === "all") return;
      event.preventDefault();
      shell.setPointerCapture(event.pointerId);
      activePan = {
        pointerId: event.pointerId,
        startX: point.x,
        startOffset: state.chartOffset,
        range: chartRangeCount()
      };
      shell.classList.add("is-panning");
      return;
    }
    event.preventDefault();
    shell.setPointerCapture(event.pointerId);

    if (tool === "line") {
      activeDraftAnnotation = { type: "line", x1: point.x, y1: point.y, x2: point.x, y2: point.y };
    } else if (tool === "brush") {
      activeDraftAnnotation = { type: "path", points: [point] };
    } else if (tool === "text") {
      const note = { type: "text", x: point.x, y: point.y, text: "" };
      addChartAnnotation(note);
      renderChartAnnotations();
      state.activeDrawingTool = "cursor";
      updateDrawingToolUi();
      requestAnimationFrame(() => {
        const notes = document.querySelectorAll(".chart-text-note");
        notes[notes.length - 1]?.focus();
      });
    }
  });

  shell.addEventListener("pointermove", (event) => {
    if (activePan) {
      event.preventDefault();
      const point = getLayerPoint(event);
      const rect = shell.getBoundingClientRect();
      const usableWidth = Math.max(1, rect.width - 78);
      const barsMoved = (point.x - activePan.startX) / usableWidth * activePan.range;
      state.chartOffset = clampChartOffset(activePan.startOffset + barsMoved);
      refreshChartOnly();
      return;
    }
    if (!activeDraftAnnotation) return;
    event.preventDefault();
    const point = getLayerPoint(event);
    if (activeDraftAnnotation.type === "line") {
      activeDraftAnnotation.x2 = point.x;
      activeDraftAnnotation.y2 = point.y;
    } else if (activeDraftAnnotation.type === "path") {
      activeDraftAnnotation.points.push(point);
    }
    renderChartAnnotations(activeDraftAnnotation);
  });

  shell.addEventListener("pointerup", (event) => {
    if (activePan) {
      event.preventDefault();
      activePan = null;
      shell.classList.remove("is-panning");
      return;
    }
    if (!activeDraftAnnotation) return;
    event.preventDefault();
    const draft = activeDraftAnnotation;
    activeDraftAnnotation = null;
    if (draft.type === "line" && Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 8) {
      addChartAnnotation(draft);
    }
    if (draft.type === "path" && draft.points.length > 2) {
      addChartAnnotation(draft);
    }
    renderChartAnnotations();
  });

  shell.addEventListener("pointercancel", () => {
    activePan = null;
    shell.classList.remove("is-panning");
    activeDraftAnnotation = null;
    renderChartAnnotations();
  });
}

function zoomChartByWheel(deltaY) {
  const total = state.currentChartLength || 60;
  const current = state.chartRange === "all" ? total : Number(state.chartRange) || total;
  const start = Math.max(0, total - current - state.chartOffset);
  const center = start + current / 2;
  const next = deltaY < 0 ? Math.max(12, Math.round(current * 0.8)) : Math.min(total, Math.round(current * 1.25));
  const nextStart = center - next / 2;
  const nextOffset = total - next - nextStart;
  setChartRangeAndOffset(next, nextOffset);
  refreshChartOnly();
}

function annotationPath(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
}

function renderChartAnnotations(draft = null) {
  const shell = $("chart-canvas-shell");
  const svg = $("chart-annotation-layer");
  const textLayer = $("chart-text-layer");
  if (!shell || !svg || !textLayer) return;
  const rect = shell.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  svg.innerHTML = "";
  textLayer.innerHTML = "";
  if (!isFullyZoomedOut()) return;

  const annotations = [...getCurrentAnnotations()];
  if (draft) annotations.push({ ...draft, draft: true });

  annotations.forEach((annotation, index) => {
    if (annotation.type === "line") {
      svg.insertAdjacentHTML("beforeend", `<line class="chart-annotation-line ${annotation.draft ? "draft" : ""}" x1="${annotation.x1}" y1="${annotation.y1}" x2="${annotation.x2}" y2="${annotation.y2}" />`);
    }
    if (annotation.type === "level") {
      svg.insertAdjacentHTML("beforeend", `<line class="chart-annotation-level" x1="0" y1="${annotation.y}" x2="${rect.width}" y2="${annotation.y}" />`);
    }
    if (annotation.type === "path") {
      svg.insertAdjacentHTML("beforeend", `<path class="chart-annotation-path ${annotation.draft ? "draft" : ""}" d="${annotationPath(annotation.points)}" />`);
    }
    if (annotation.type === "marker") {
      const label = annotation.tool === "smile" ? "⌣" : "◇";
      svg.insertAdjacentHTML("beforeend", `<text class="chart-annotation-marker" x="${annotation.x}" y="${annotation.y}">${label}</text>`);
    }
    if (annotation.type === "text") {
      const wrapper = document.createElement("div");
      wrapper.className = `chart-text-note-wrap ${annotation.text?.trim() ? "has-text" : ""}`;
      wrapper.style.left = `${annotation.x}px`;
      wrapper.style.top = `${annotation.y}px`;

      const controls = document.createElement("div");
      controls.className = "chart-text-controls";
      const moveHandle = document.createElement("span");
      moveHandle.className = "chart-text-move";
      moveHandle.textContent = "↕";
      moveHandle.setAttribute("aria-label", "텍스트 이동");
      const decrease = document.createElement("button");
      decrease.type = "button";
      decrease.textContent = "A-";
      decrease.setAttribute("aria-label", "글씨 작게");
      const increase = document.createElement("button");
      increase.type = "button";
      increase.textContent = "A+";
      increase.setAttribute("aria-label", "글씨 크게");
      controls.append(moveHandle, decrease, increase);

      const note = document.createElement("div");
      note.className = "chart-text-note";
      note.contentEditable = "true";
      note.spellcheck = false;
      note.textContent = annotation.text;
      note.style.fontSize = `${annotation.fontSize || 13}px`;

      const updateFontSize = (delta) => {
        const source = getCurrentAnnotations()[index];
        if (!source) return;
        const currentSize = source.fontSize || 13;
        source.fontSize = Math.max(10, Math.min(40, currentSize + delta));
        note.style.fontSize = `${source.fontSize}px`;
      };

      decrease.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        updateFontSize(-1);
      });
      increase.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        updateFontSize(1);
      });
      note.addEventListener("input", () => {
        const source = getCurrentAnnotations()[index];
        if (source) {
          source.text = note.textContent || "";
          wrapper.classList.toggle("has-text", Boolean(source.text.trim()));
        }
      });
      note.addEventListener("wheel", (event) => {
        event.preventDefault();
        event.stopPropagation();
        updateFontSize(event.deltaY < 0 ? 1 : -1);
      }, { passive: false });

      let dragState = null;
      moveHandle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        moveHandle.setPointerCapture(event.pointerId);
        dragState = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: annotation.x,
          originY: annotation.y
        };
        wrapper.classList.add("is-dragging");
      });
      moveHandle.addEventListener("pointermove", (event) => {
        if (!dragState) return;
        event.preventDefault();
        event.stopPropagation();
        const source = getCurrentAnnotations()[index];
        if (!source) return;
        const shell = $("chart-canvas-shell");
        const rect = shell?.getBoundingClientRect();
        const maxX = rect ? rect.width - 20 : Number.POSITIVE_INFINITY;
        const maxY = rect ? rect.height - 20 : Number.POSITIVE_INFINITY;
        source.x = Math.max(0, Math.min(maxX, dragState.originX + event.clientX - dragState.startX));
        source.y = Math.max(0, Math.min(maxY, dragState.originY + event.clientY - dragState.startY));
        annotation.x = source.x;
        annotation.y = source.y;
        wrapper.style.left = `${source.x}px`;
        wrapper.style.top = `${source.y}px`;
      });
      const endDrag = (event) => {
        if (!dragState) return;
        event.preventDefault();
        event.stopPropagation();
        dragState = null;
        wrapper.classList.remove("is-dragging");
      };
      moveHandle.addEventListener("pointerup", endDrag);
      moveHandle.addEventListener("pointercancel", endDrag);
      wrapper.append(controls, note);
      textLayer.appendChild(wrapper);
    }
  });
}

function searchPriority(stock, normalizedKeyword) {
  const name = compactText(stock.name);
  const code = compactText(stock.code);
  const sector = compactText(stock.sector || stock.industry || "");
  const rank = stockSearchRank[stock.code] || 999999;
  const hasDetail = data.stocks.some((item) => item.code === stock.code);
  const isSpac = stock.name.includes("스팩") || /스팩\d/.test(stock.name);
  const isPreferred = /우$|우B$|우C$/.test(stock.name);

  let matchScore = 700;
  if (!normalizedKeyword) matchScore = 300;
  else if (code === normalizedKeyword || name === normalizedKeyword) matchScore = 0;
  else if (code.startsWith(normalizedKeyword) || name.startsWith(normalizedKeyword)) matchScore = 80;
  else if (name.includes(normalizedKeyword) || code.includes(normalizedKeyword)) matchScore = 180;
  else if (sector.includes(normalizedKeyword)) matchScore = 360;

  let qualityPenalty = 0;
  if (isSpac && !normalizedKeyword.includes("스팩")) qualityPenalty += 420;
  if (isPreferred && normalizedKeyword !== code && !name.startsWith(normalizedKeyword)) qualityPenalty += 180;

  const detailBoost = normalizedKeyword && hasDetail ? -20 : 0;
  return matchScore + qualityPenalty + detailBoost + rank / 5;
}

function saveWatchlist() {
  localStorage.setItem("kr-watchlist", JSON.stringify(state.watchlist));
}

function saveCollapsedPanels() {
  localStorage.setItem("kr-collapsed-panels", JSON.stringify(state.collapsedPanels));
}

function getSearchMatches(query = "") {
  const normalizedKeyword = compactText(query);
  if (!normalizedKeyword) return [];
  return stockUniverse.filter((stock) => {
    const haystack = `${stock.name} ${stock.code} ${stock.market} ${stock.sector || ""} ${stock.industry || ""}`.toLowerCase();
    return haystack.replace(/\s+/g, "").includes(normalizedKeyword);
  }).sort((a, b) => {
    const scoreDiff = searchPriority(a, normalizedKeyword) - searchPriority(b, normalizedKeyword);
    if (scoreDiff !== 0) return scoreDiff;
    return (stockSearchRank[a.code] || 999999) - (stockSearchRank[b.code] || 999999);
  });
}

function yahooSymbol(entry) {
  return `${String(entry.code).padStart(6, "0")}.${entry.market === "KOSDAQ" ? "KQ" : "KS"}`;
}

function emptyFundamentals() {
  return {
    per: null,
    pbr: null,
    roe: null,
    revenueGrowth: null,
    opGrowth: null,
    netGrowth: null,
    debtRatio: null,
    opMargin: null,
    dividendYield: null,
    foreignRatio: null
  };
}

function buildDynamicStock(entry, chartResult) {
  const meta = chartResult.meta || {};
  const quote = chartResult.indicators?.quote?.[0] || {};
  const closeValues = quote.close || [];
  const volumeValues = quote.volume || [];
  const highValues = quote.high || [];
  const lowValues = quote.low || [];
  const closes = closeValues.filter((value) => Number.isFinite(value)).slice(-60).map((value) => Math.round(value));
  const volumes = volumeValues.filter((value) => Number.isFinite(value)).slice(-60).map((value) => Math.round(value));
  if (closes.length < 20) throw new Error("Not enough chart data");

  const price = Math.round(Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : closes[closes.length - 1]);
  const previousClose = closes[closes.length - 2] || price;
  const changeRate = previousClose ? Number(((price - previousClose) / previousClose * 100).toFixed(2)) : 0;
  const highs = highValues.filter((value) => Number.isFinite(value));
  const lows = lowValues.filter((value) => Number.isFinite(value));
  const weekHigh = Math.round(Math.max(...highs.slice(-252), price));
  const weekLow = Math.round(Math.min(...lows.slice(-252), price));
  const lastVolume = volumes[volumes.length - 1] || 0;
  const avgVolume20 = Math.round(volumes.slice(-20).reduce((sum, value) => sum + value, 0) / Math.min(20, volumes.length));
  const updatedTime = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000) : new Date();

  return {
    code: entry.code,
    name: entry.name,
    market: entry.market || (meta.exchangeName === "KOE" ? "KOSDAQ" : "KOSPI"),
    sector: entry.sector || entry.industry || "업종 정보 준비 중",
    price,
    changeRate,
    volume: lastVolume,
    avgVolume20,
    marketCap: "동적 조회",
    weekHigh,
    weekLow,
    updatedAt: `${updatedTime.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} Yahoo Finance 기준`,
    fundamentals: emptyFundamentals(),
    sectorAverage: emptyFundamentals(),
    flows: {
      available: false,
      individual: { d1: 0, d5: 0, d20: 0 },
      foreign: { d1: 0, d5: 0, d20: 0 },
      institution: { d1: 0, d5: 0, d20: 0 }
    },
    news: [],
    disclosures: [],
    backtest: {
      period: "확장 기능에서 제공",
      buyRule: "전략 조건 설정 필요",
      sellRule: "전략 조건 설정 필요",
      returnRate: null,
      mdd: null,
      winRate: null,
      holdingDays: null,
      excessReturn: null
    },
    prices: closes,
    volumes
  };
}

function fetchDynamicStock(entry) {
  if (dynamicStockCache.has(entry.code)) return Promise.resolve(dynamicStockCache.get(entry.code));
  if (dynamicStockRequests.has(entry.code)) return dynamicStockRequests.get(entry.code);

  const symbol = yahooSymbol(entry);
  const proxyUrl = `/api/chart?symbol=${encodeURIComponent(symbol)}&range=6mo&interval=1d`;
  const directUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=6mo&interval=1d`;
  const request = fetch(proxyUrl)
    .then((response) => (response.ok ? response : fetch(directUrl)))
    .catch(() => fetch(directUrl))
    .then((response) => {
      if (!response.ok) throw new Error(`Yahoo chart request failed: ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      const result = payload.chart?.result?.[0];
      if (!result) throw new Error("No chart result");
      const stock = buildDynamicStock(entry, result);
      dynamicStockCache.set(entry.code, stock);
      return stock;
    })
    .finally(() => dynamicStockRequests.delete(entry.code));

  dynamicStockRequests.set(entry.code, request);
  return request;
}

function setupCollapsiblePanels() {
  const panels = document.querySelectorAll(".price-panel, .signal-card, .mode-panel, .chart-panel, .analysis-panel, .roadmap");
  panels.forEach((panel, index) => {
    if (panel.dataset.collapsibleReady) return;
    const heading = panel.querySelector(".section-heading h2, h1, h2, .meta, .brand strong, strong");
    const title = heading ? heading.textContent.trim() : `패널 ${index + 1}`;
    const id = panel.id || Array.from(panel.classList).find((name) => name.endsWith("-panel") || name.endsWith("-card")) || `panel-${index}`;
    panel.dataset.panelId = id;
    panel.dataset.collapsibleReady = "true";

    const bar = document.createElement("div");
    bar.className = "collapse-bar";

    const button = document.createElement("button");
    button.className = "collapse-toggle";
    button.type = "button";
    button.setAttribute("aria-label", `${title} 접기`);
    button.setAttribute("aria-expanded", "true");
    button.textContent = "−";

    const collapsedTitle = document.createElement("span");
    collapsedTitle.className = "collapsed-title";
    collapsedTitle.textContent = title;
    bar.append(collapsedTitle, button);
    panel.prepend(bar);

    button.addEventListener("click", () => {
      const isCollapsed = panel.classList.toggle("is-collapsed");
      button.textContent = isCollapsed ? "+" : "−";
      button.setAttribute("aria-expanded", String(!isCollapsed));
      button.setAttribute("aria-label", `${title} ${isCollapsed ? "펼치기" : "접기"}`);
      state.collapsedPanels = isCollapsed
        ? Array.from(new Set([...state.collapsedPanels, id]))
        : state.collapsedPanels.filter((panelId) => panelId !== id);
      saveCollapsedPanels();
      requestAnimationFrame(layoutAnalysisMasonry);
    });
  });
  applyCollapsedPanels();
}

function applyCollapsedPanels() {
  document.querySelectorAll("[data-panel-id]").forEach((panel) => {
    const id = panel.dataset.panelId;
    const isCollapsed = state.collapsedPanels.includes(id);
    const button = panel.querySelector(".collapse-toggle");
    panel.classList.toggle("is-collapsed", isCollapsed);
    if (button) {
      const title = panel.querySelector(".collapsed-title")?.textContent || "패널";
      button.textContent = isCollapsed ? "+" : "−";
      button.setAttribute("aria-expanded", String(!isCollapsed));
      button.setAttribute("aria-label", `${title} ${isCollapsed ? "펼치기" : "접기"}`);
    }
  });
}

function renderSearchResults(query = "") {
  const target = $("search-results");
  const normalizedKeyword = compactText(query);
  if (!normalizedKeyword) {
    target.innerHTML = "";
    target.style.display = "none";
    return;
  }
  const matches = getSearchMatches(query);
  target.innerHTML = matches
    .slice(0, 80)
    .map((stock) => {
      const hasDetail = data.stocks.some((item) => item.code === stock.code);
      const meta = [stock.code, stock.market, stock.sector || stock.industry].filter(Boolean).join(" · ");
      return `<button class="search-result" type="button" data-code="${stock.code}">
        <span><strong>${stock.name}</strong><span>${meta}</span></span>
        <small>${hasDetail ? "상세 분석" : "실시간 분석"}</small>
      </button>`;
    })
    .join("");
  target.style.display = matches.length ? "block" : "none";
}

function indicatorCard(item) {
  const tag = item.tag || signalFromScore(item.score, item.max);
  return `<div class="indicator-card">
    <strong>${item.name}</strong>
    <div>${item.value}</div>
    <p class="subtle">${item.detail}</p>
    <span class="tag ${tag.tone}">${tag.label}</span>
  </div>`;
}

function signalFromScore(score, max) {
  const ratio = score / max;
  if (ratio >= 0.68) return { label: "매수 신호", tone: "buy" };
  if (ratio <= 0.38) return { label: "매도 신호", tone: "sell" };
  return { label: "중립", tone: "hold" };
}

function renderSummary(stock, analysis) {
  setPriceFallbackMode(false);
  $("stock-market").textContent = `${stock.market} · ${stock.sector}`;
  $("stock-name").textContent = stock.name;
  $("stock-code").textContent = stock.code;
  $("latest-price").textContent = formatWon(stock.price);
  $("change-rate").textContent = `${stock.changeRate > 0 ? "+" : ""}${stock.changeRate.toFixed(2)}%`;
  $("change-rate").className = percentClass(stock.changeRate);
  $("volume").textContent = stock.volume.toLocaleString();
  $("market-cap").textContent = stock.marketCap;
  $("week-range").textContent = `${formatWon(stock.weekHigh)} / ${formatWon(stock.weekLow)}`;
  $("updated-at").textContent = stock.updatedAt;
  $("footer-update").textContent = `데이터 업데이트: ${stock.updatedAt}`;

  const signalCard = $("signal-card");
  signalCard.className = `signal-card ${analysis.tone} decision-panel`;
  $("final-signal").textContent = analysis.signal;
  $("total-score").textContent = `${analysis.total.toFixed(1)}점`;
  $("scorebar-fill").style.width = `${analysis.total}%`;
  $("scorebar-fill").style.background = analysis.tone === "buy" ? "var(--green)" : analysis.tone === "sell" ? "var(--blue)" : "var(--amber)";
  $("confidence").textContent = `${analysis.confidence.label} (${analysis.confidence.score.toFixed(0)}점)${analysis.confidence.warning ? ` · ${analysis.confidence.warning}` : ""}`;
  $("top-reasons").innerHTML = analysis.reasons.map((reason) => `<li>${reason}</li>`).join("");

  const watchButton = $("watch-button");
  const watched = state.watchlist.includes(stock.code);
  watchButton.textContent = watched ? "관심 해제" : "관심 추가";
  watchButton.classList.toggle("active", watched);
}

function renderAnalysis(stock, analysis) {
  $("technical-score").textContent = `${analysis.weighted.technical.toFixed(1)} / ${analysis.profile.weights.technical}점`;
  $("fundamental-score").textContent = `${analysis.weighted.fundamental.toFixed(1)} / ${analysis.profile.weights.fundamental}점`;
  $("flow-score").textContent = `${analysis.weighted.flow.toFixed(1)} / ${analysis.profile.weights.flow}점`;
  $("news-score").textContent = `${analysis.weighted.news.toFixed(1)} / ${analysis.profile.weights.news}점`;
  $("market-score").textContent = `${analysis.weighted.market.toFixed(1)} / ${analysis.profile.weights.market}점`;

  $("technical-grid").innerHTML = analysis.sections.technical.items.map(indicatorCard).join("");
  $("fundamental-grid").innerHTML = analysis.sections.fundamental.items.map(indicatorCard).join("");
  $("flow-grid").innerHTML = analysis.sections.flow.items
    .map((item) => `<div class="flow-card"><strong>${item.name}</strong><dl class="metric-list compact"><div><dt>1일</dt><dd>${item.d1 === null ? "API 연결 필요" : engine.formatSigned(item.d1)}</dd></div><div><dt>5일</dt><dd>${item.d5 === null ? "API 연결 필요" : engine.formatSigned(item.d5)}</dd></div><div><dt>20일</dt><dd>${item.d20 === null ? "API 연결 필요" : engine.formatSigned(item.d20)}</dd></div></dl></div>`)
    .join("");
  $("news-list").innerHTML = analysis.sections.news.unavailable ? `<div class="news-card"><strong>뉴스/공시 분석 연결 필요</strong><p class="subtle">현재 화면은 가격과 주요 재무 지표를 우선 반영합니다. 뉴스 감성, 공시 리스크는 별도 API 연결 후 판단에 포함됩니다.</p><span class="tag hold">확장 예정</span></div>` : [
    ...analysis.sections.news.items.map((item) => `<div class="news-card"><strong>${item.title}</strong><p class="subtle">${item.summary}</p><span class="tag ${item.sentiment === "긍정" ? "buy" : item.sentiment === "부정" ? "sell" : "hold"}">${item.sentiment} · ${item.impact}</span></div>`),
    ...analysis.sections.news.disclosures.map((item) => `<div class="news-card"><strong>공시: ${item.title}</strong><p class="subtle">주가 영향은 ${item.impact} 요인으로 분류됩니다.</p><span class="tag hold">공시</span></div>`)
  ].join("");
  $("market-grid").innerHTML = analysis.sections.market.items.map((item) => `<div class="indicator-card"><strong>${item.name}</strong><div>${item.value}</div><p class="subtle">${item.detail}</p></div>`).join("");
  $("risk-list").innerHTML = analysis.risks.map((risk) => `<li>${risk}</li>`).join("");
  $("backtest-grid").innerHTML = [
    ["테스트 기간", stock.backtest.period],
    ["매수 조건", stock.backtest.buyRule],
    ["매도 조건", stock.backtest.sellRule],
    ["누적 수익률", formatNullable(stock.backtest.returnRate, "%")],
    ["최대 낙폭", formatNullable(stock.backtest.mdd, "%")],
    ["승률", formatNullable(stock.backtest.winRate, "%")],
    ["평균 보유 기간", formatNullable(stock.backtest.holdingDays, "일")],
    [`${stock.market} 대비 초과 수익률`, formatNullable(stock.backtest.excessReturn, "%")]
  ].map(([label, value]) => `<div class="metric-card"><strong>${label}</strong><span>${value}</span></div>`).join("");
}

function renderMode() {
  document.querySelectorAll(".mode-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });
  $("mode-description").textContent = engine.modeProfiles[state.mode].description;
}

function renderWatchlist() {
  if (!state.watchlist.length) {
    $("watchlist-items").innerHTML = `<p class="subtle">관심 종목이 없습니다. 종목 상세에서 관심 추가를 눌러 저장할 수 있습니다.</p>`;
    return;
  }
  $("watchlist-items").innerHTML = state.watchlist.map((code) => {
    const stock = data.stocks.find((item) => item.code === code);
    if (!stock) {
      const entry = getStockEntry(code);
      if (!entry) return "";
      return `<button class="watch-item" type="button" data-code="${entry.code}">
        <strong>${entry.name} · 실시간 차트</strong>
        <span>${entry.code} · ${entry.market || "KOSPI/KOSDAQ"} · TradingView 확인</span>
      </button>`;
    }
    const analysis = engine.analyze(stock, data.market, state.mode);
    const changed = stock.changeRate > 1.5 || analysis.total >= 70 || analysis.total < 40;
    return `<button class="watch-item ${changed ? "changed" : ""}" type="button" data-code="${stock.code}">
      <strong>${stock.name} · ${analysis.signal}</strong>
      <span>${analysis.total.toFixed(1)}점 · <span class="${percentClass(stock.changeRate)}">${stock.changeRate > 0 ? "+" : ""}${stock.changeRate.toFixed(2)}%</span></span>
    </button>`;
  }).join("");
}

function setPriceFallbackMode(enabled) {
  document.querySelector(".price-line")?.classList.toggle("is-unavailable", enabled);
}

function clampCanvasValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function drawChartBadge(ctx, text, x, y, color, width, height, align = "left") {
  const paddingX = 7;
  const badgeHeight = 21;
  const badgeWidth = Math.ceil(ctx.measureText(text).width) + paddingX * 2;
  const left = clampCanvasValue(align === "right" ? x - badgeWidth : x, 4, width - badgeWidth - 4);
  const top = clampCanvasValue(y - badgeHeight + 6, 4, height - badgeHeight - 4);

  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
  ctx.strokeStyle = "rgba(217, 225, 232, 0.95)";
  ctx.lineWidth = 1;
  ctx.fillRect(left, top, badgeWidth, badgeHeight);
  ctx.strokeRect(left, top, badgeWidth, badgeHeight);
  ctx.fillStyle = color;
  ctx.fillText(text, left + paddingX, top + 15);
  ctx.restore();
  return top + 15;
}

function placeChartLabel(targetY, occupied, minY, maxY, direction = 1) {
  let nextY = clampCanvasValue(targetY, minY, maxY);
  let attempts = 0;
  while (occupied.some((usedY) => Math.abs(usedY - nextY) < 24) && attempts < 8) {
    nextY = clampCanvasValue(nextY + direction * 24, minY, maxY);
    attempts += 1;
  }
  occupied.push(nextY);
  return nextY;
}

function drawChart(stock, analysis, canvasId = "price-chart") {
  const canvas = $(canvasId);
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const height = canvasId === "tradingview-local-chart" ? 430 : 460;
  canvas.width = Math.max(rect.width, 320) * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);

  const width = Math.max(rect.width, 320);
  const pad = { left: 56, right: 22, top: 26, bottom: 92 };
  state.currentChartLength = stock.prices.length;
  const rangeCount = chartRangeCount(stock.prices.length);
  state.chartOffset = clampChartOffset(state.chartOffset, stock.prices.length, rangeCount);
  const startIndex = Math.max(0, stock.prices.length - rangeCount - state.chartOffset);
  const endIndex = Math.min(stock.prices.length, startIndex + rangeCount);
  const prices = stock.prices.slice(startIndex, endIndex);
  const volumes = stock.volumes.slice(startIndex, endIndex);
  const highs = prices.map((price, index) => price * (1 + (volumes[index] % 5) / 100));
  const lows = prices.map((price, index) => price * (1 - ((volumes[index] % 4) + 1) / 100));
  const allPrices = [...highs, ...lows, analysis.sections.technical.indicators.ma20, stock.weekHigh, stock.weekLow];
  const minPrice = Math.min(...allPrices) * 0.98;
  const maxPrice = Math.max(...allPrices) * 1.02;
  const chartHeight = height - pad.top - pad.bottom;
  const volumeTop = height - 72;
  const volumeHeight = 48;
  const step = (width - pad.left - pad.right) / prices.length;
  const x = (index) => pad.left + index * step + step * 0.5;
  const y = (price) => pad.top + (maxPrice - price) / (maxPrice - minPrice) * chartHeight;
  const occupiedLabelYs = [];

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#e2e8ef";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const gy = pad.top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(width - pad.right, gy);
    ctx.stroke();
  }

  if (isFullyZoomedOut()) {
    ctx.fillStyle = "#657384";
    ctx.font = "12px Segoe UI";
    [maxPrice, (maxPrice + minPrice) / 2, minPrice].forEach((price) => {
      ctx.fillText(Math.round(price).toLocaleString(), 6, y(price) + 4);
    });
    ctx.fillStyle = "#17212b";
    ctx.font = "700 13px Segoe UI";
    ctx.fillText(currentChartModeText(), pad.left, 18);
  }

  const maxVolume = Math.max(...volumes);
  volumes.forEach((volume, index) => {
    const barHeight = (volume / maxVolume) * volumeHeight;
    ctx.fillStyle = prices[index] >= (prices[index - 1] || prices[index]) ? "rgba(200, 62, 77, 0.35)" : "rgba(31, 111, 178, 0.35)";
    ctx.fillRect(x(index) - step * 0.28, volumeTop + volumeHeight - barHeight, step * 0.55, barHeight);
  });

  if (state.chartStyle === "line") {
    ctx.strokeStyle = "#1f6fb2";
    ctx.lineWidth = 2;
    ctx.beginPath();
    prices.forEach((close, index) => {
      if (index === 0) ctx.moveTo(x(index), y(close));
      else ctx.lineTo(x(index), y(close));
    });
    ctx.stroke();
  } else {
    prices.forEach((close, index) => {
      const open = prices[index - 1] || close * 0.995;
      const high = highs[index];
      const low = lows[index];
      const up = close >= open;
      const cx = x(index);
      ctx.strokeStyle = up ? "#c83e4d" : "#1f6fb2";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(cx, y(high));
      ctx.lineTo(cx, y(low));
      ctx.stroke();
      const bodyTop = Math.min(y(open), y(close));
      const bodyHeight = Math.max(3, Math.abs(y(open) - y(close)));
      ctx.fillRect(cx - step * 0.25, bodyTop, Math.max(2, step * 0.5), bodyHeight);
    });
  }

  const ma20Series = prices.map((_, index) => {
    const sample = prices.slice(Math.max(0, index - 19), index + 1);
    return sample.reduce((sum, value) => sum + value, 0) / sample.length;
  });
  if (state.showMa) {
    ctx.strokeStyle = "#12805c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ma20Series.forEach((value, index) => {
      if (index === 0) ctx.moveTo(x(index), y(value));
      else ctx.lineTo(x(index), y(value));
    });
    ctx.stroke();
  }

  if (isFullyZoomedOut()) {
    const support = Math.min(...prices.slice(-12));
    const resistance = Math.max(...prices.slice(-12));
    [
      ["저항선", resistance, "#a86b00", -1],
      ["지지선", support, "#1f6fb2", 1]
    ].forEach(([label, price, color, direction]) => {
      const lineY = y(price);
      ctx.strokeStyle = color;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.left, lineY);
      ctx.lineTo(width - pad.right, lineY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "700 12px Segoe UI";
      const labelY = placeChartLabel(lineY + direction * 18, occupiedLabelYs, pad.top + 15, volumeTop - 8, direction);
      drawChartBadge(ctx, label, width - pad.right - 8, labelY, color, width, height, "right");
    });
  }

  if (isFullyZoomedOut() && state.showSignals && prices.length >= 5) {
    const signalIndex = prices.length - 5;
    const signalY = y(prices[signalIndex]);
    ctx.fillStyle = analysis.tone === "buy" ? "#12805c" : analysis.tone === "sell" ? "#1f6fb2" : "#a86b00";
    ctx.beginPath();
    ctx.arc(x(signalIndex), signalY - 14, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "700 12px Segoe UI";
    const labelY = placeChartLabel(signalY - 20, occupiedLabelYs, pad.top + 15, volumeTop - 8, -1);
    drawChartBadge(ctx, analysis.signal, x(signalIndex) + 12, labelY, ctx.fillStyle, width, height);
  }

  if (canvasId === "tradingview-local-chart") renderChartInfo(stock, analysis, prices);
}

function renderChartInfo(stock, analysis, visiblePrices) {
  const panel = $("chart-info-panel");
  if (!panel) return;
  const lastPrice = visiblePrices[visiblePrices.length - 1] || stock.price;
  const firstPrice = visiblePrices[0] || lastPrice;
  const visibleChange = firstPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
  const high = Math.max(...visiblePrices);
  const low = Math.min(...visiblePrices);
  panel.innerHTML = `
    <strong>${stock.code}</strong>
    <span>${stock.name} · ${stock.market}</span>
    <div class="chart-info-price">${formatWon(stock.price)}</div>
    <div class="${percentClass(stock.changeRate)}">${stock.changeRate > 0 ? "+" : ""}${stock.changeRate.toFixed(2)}%</div>
    <dl>
      <div><dt>간격</dt><dd>${intervalLabel(state.chartInterval)}</dd></div>
      <div><dt>표시 구간</dt><dd>${state.chartRange === "all" ? "전체" : `${state.chartRange}일`}</dd></div>
      <div><dt>도구</dt><dd>${chartToolLabel(state.activeDrawingTool)}</dd></div>
      <div><dt>구간 등락</dt><dd class="${percentClass(visibleChange)}">${visibleChange > 0 ? "+" : ""}${visibleChange.toFixed(2)}%</dd></div>
      <div><dt>구간 고가</dt><dd>${formatWon(high)}</dd></div>
      <div><dt>구간 저가</dt><dd>${formatWon(low)}</dd></div>
      <div><dt>신호</dt><dd>${analysis.signal}</dd></div>
      <div><dt>점수</dt><dd>${analysis.total.toFixed(1)}점</dd></div>
    </dl>`;
}

function drawUnavailableChart(entry, canvasId = "price-chart") {
  const canvas = $(canvasId);
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const height = canvasId === "tradingview-local-chart" ? 430 : 460;
  canvas.width = Math.max(rect.width, 320) * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const width = Math.max(rect.width, 320);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#e2e8ef";
  for (let i = 0; i < 6; i += 1) {
    const y = 42 + i * 62;
    ctx.beginPath();
    ctx.moveTo(28, y);
    ctx.lineTo(width - 28, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#17212b";
  ctx.font = "700 20px Segoe UI";
  ctx.fillText(`${entry.name} (${entry.code})`, 34, 112);
  ctx.fillStyle = "#657384";
  ctx.font = "14px Segoe UI";
  ctx.fillText("상단 TradingView 위젯에서 이 종목의 실시간 차트를 확인할 수 있습니다.", 34, 150);
  ctx.fillText("아래 로컬 분석 차트는 정량 분석 데이터가 있는 종목에서 이동평균과 신호 지점을 함께 표시합니다.", 34, 176);
  if (canvasId === "tradingview-local-chart") renderUnavailableChartInfo(entry);
}

function renderUnavailableChartInfo(entry) {
  const panel = $("chart-info-panel");
  if (!panel) return;
  panel.innerHTML = `
    <strong>${entry.code}</strong>
    <span>${entry.name} · ${entry.market || "KOSPI/KOSDAQ"}</span>
    <div class="chart-info-price">차트 확인</div>
    <dl>
      <div><dt>시장</dt><dd>${entry.market || "확인 필요"}</dd></div>
      <div><dt>업종</dt><dd>${entry.sector || entry.industry || "확장 예정"}</dd></div>
      <div><dt>점수</dt><dd>데이터 연결 후 제공</dd></div>
      <div><dt>신호</dt><dd>차트 중심 확인</dd></div>
    </dl>`;
}

function layoutAnalysisMasonry() {
  const container = document.querySelector(".analysis-masonry");
  if (!container) return;
  const panels = Array.from(container.querySelectorAll(".analysis-panel"));
  const gap = 16;
  const width = container.clientWidth;
  const columns = width >= 1180 ? 3 : width >= 760 ? 2 : 1;
  const columnWidth = (width - gap * (columns - 1)) / columns;
  const heights = Array(columns).fill(0);

  panels.forEach((panel) => {
    panel.style.width = `${columnWidth}px`;
    panel.style.position = "absolute";
  });

  panels.forEach((panel) => {
    const targetColumn = heights.indexOf(Math.min(...heights));
    const x = targetColumn * (columnWidth + gap);
    const y = heights[targetColumn];
    panel.style.transform = `translate(${x}px, ${y}px)`;
    heights[targetColumn] += panel.offsetHeight + gap;
  });

  container.style.height = `${Math.max(...heights, 0) - gap}px`;
}

function renderUnavailable(entry) {
  renderMode();
  setPriceFallbackMode(true);
  $("stock-market").textContent = `${entry.market || "KOSPI/KOSDAQ"}${entry.sector ? ` · ${entry.sector}` : ""}`;
  $("stock-name").textContent = entry.name;
  $("stock-code").textContent = entry.code;
  $("latest-price").textContent = "가격 데이터 조회 중";
  $("change-rate").textContent = "차트는 아래에서 확인";
  $("change-rate").className = "neutral";
  $("volume").textContent = "차트 내 거래량 확인";
  $("market-cap").textContent = "추가 지표 준비 중";
  $("week-range").textContent = "차트 기간에서 확인";
  $("updated-at").textContent = data.updatedAt;
  $("footer-update").textContent = `종목 목록 업데이트: ${data.updatedAt}`;

  const signalCard = $("signal-card");
  signalCard.className = "signal-card hold decision-panel is-unavailable";
  $("final-signal").textContent = "분석 준비 중";
  $("total-score").textContent = "점수 산정 전";
  $("scorebar-fill").style.width = "45%";
  $("scorebar-fill").style.background = "var(--amber)";
  $("confidence").textContent = "참고용 · 가격 데이터 조회가 완료되면 정량 분석으로 자동 전환됩니다.";
  $("top-reasons").innerHTML = [
    `${entry.name}(${entry.code}) 종목이 검색 결과에서 선택되었습니다.`,
    "상단 TradingView 차트에서 현재 주가 흐름과 거래량을 직접 확인할 수 있습니다.",
    "정량 점수는 가격·재무·수급 지표가 충분히 확보된 종목에만 표시합니다."
  ].map((reason) => `<li>${reason}</li>`).join("");

  $("technical-score").textContent = "차트 확인";
  $("fundamental-score").textContent = "확장 예정";
  $("flow-score").textContent = "확장 예정";
  $("news-score").textContent = "확장 예정";
  $("market-score").textContent = "시장 구분 확인";
  const unavailableCard = (title) => `<div class="indicator-card"><strong>${title}</strong><div>TradingView에서 확인</div><p class="subtle">실시간 차트에서 가격 흐름을 먼저 확인하고, 정량 지표는 데이터 범위가 확장되면 함께 표시됩니다.</p><span class="tag hold">차트 기반 확인</span></div>`;
  $("technical-grid").innerHTML = ["이동평균선", "RSI", "MACD", "거래량 변화"].map(unavailableCard).join("");
  $("fundamental-grid").innerHTML = ["PER", "PBR", "ROE", "성장률"].map((title) => `<div class="indicator-card"><strong>${title}</strong><div>확장 예정</div><p class="subtle">재무 지표는 다음 데이터 업데이트 범위에서 순차적으로 추가됩니다.</p><span class="tag hold">참고 제외</span></div>`).join("");
  $("flow-grid").innerHTML = ["개인", "외국인", "기관"].map((name) => `<div class="flow-card"><strong>${name}</strong><p class="subtle">투자자별 순매수 흐름은 확장 기능에서 표시됩니다.</p></div>`).join("");
  $("news-list").innerHTML = `<div class="news-card"><strong>뉴스/공시 요약</strong><p class="subtle">뉴스와 공시 분석은 확장 단계에서 연결됩니다. 현재는 차트 중심으로 흐름을 확인해 주세요.</p><span class="tag hold">확장 예정</span></div>`;
  $("market-grid").innerHTML = [
    { name: "시장", value: entry.market || "KOSPI/KOSDAQ", detail: "시장 구분만 검색 목록에서 확인됩니다." },
    { name: "업종", value: entry.sector || entry.industry || "업종 정보 준비 중", detail: "업종 데이터는 제공되는 경우에만 표시됩니다." }
  ].map((item) => `<div class="indicator-card"><strong>${item.name}</strong><div>${item.value}</div><p class="subtle">${item.detail}</p></div>`).join("");
  $("risk-list").innerHTML = [
    "TradingView 차트의 변동성, 거래량 급증 여부를 함께 확인해야 합니다.",
    "재무·수급 지표가 아직 점수에 포함되지 않아 정량 판단은 보수적으로 봐야 합니다.",
    "뉴스와 공시 이슈는 별도 확인 후 투자 판단에 반영해야 합니다."
  ].map((risk) => `<li>${risk}</li>`).join("");
  $("backtest-grid").innerHTML = ["테스트 기간", "누적 수익률", "최대 낙폭", "승률"].map((label) => `<div class="metric-card"><strong>${label}</strong><span>확장 기능에서 제공</span></div>`).join("");
  renderTradingViewChart(entry);
  drawUnavailableChart(entry, "tradingview-local-chart");
  requestAnimationFrame(layoutAnalysisMasonry);

  const watchButton = $("watch-button");
  const watched = state.watchlist.includes(entry.code);
  watchButton.textContent = watched ? "관심 해제" : "관심 추가";
  watchButton.classList.toggle("active", watched);
  renderWatchlist();
}

function renderDetailedStock(stock) {
  const analysis = engine.analyze(stock, data.market, state.mode);
  renderMode();
  renderSummary(stock, analysis);
  renderAnalysis(stock, analysis);
  renderWatchlist();
  renderTradingViewChart(stock);
  drawChart(stock, analysis, "tradingview-local-chart");
  setupCollapsiblePanels();
  requestAnimationFrame(layoutAnalysisMasonry);
}

function render() {
  const detailedStock = data.stocks.find((item) => item.code === state.selectedCode);
  if (detailedStock) {
    renderDetailedStock(detailedStock);
    return;
  }

  const entry = getStockEntry(state.selectedCode);
  if (entry) {
    const cachedStock = dynamicStockCache.get(entry.code);
    if (cachedStock) {
      renderDetailedStock(cachedStock);
      return;
    }

    renderUnavailable(entry);
    fetchDynamicStock(entry)
      .then((stock) => {
        if (state.selectedCode === stock.code) renderDetailedStock(stock);
      })
      .catch(() => {
        if (state.selectedCode === entry.code) {
          $("confidence").textContent = "참고용 · 실시간 가격 자동 조회가 지연되어 TradingView 차트를 우선 표시합니다.";
        }
      });
    return;
  }

  renderDetailedStock(getStock());
}

function selectStock(code, options = {}) {
  const { clearSearch = true, hideResults = true } = options;
  state.selectedCode = code;
  if (clearSearch) $("stock-search").value = "";
  if (hideResults) $("search-results").style.display = "none";
  render();
}

function handleSearchInput(event) {
  const query = event.target.value;
  renderSearchResults(query);
  const normalizedKeyword = compactText(query);
  if (normalizedKeyword.length < 2) return;
  const bestMatch = getSearchMatches(query)[0];
  if (bestMatch && bestMatch.code !== state.selectedCode) {
    selectStock(bestMatch.code, { clearSearch: false, hideResults: false });
  }
}

$("stock-search").addEventListener("input", handleSearchInput);
$("stock-search").addEventListener("keyup", handleSearchInput);
$("stock-search").addEventListener("change", handleSearchInput);
$("stock-search").addEventListener("click", (event) => renderSearchResults(event.target.value));
$("search-results").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-code]");
  if (button) selectStock(button.dataset.code);
});
document.querySelector(".notice-link").addEventListener("click", (event) => {
  event.preventDefault();
  const notice = $("investment-notice");
  const willShow = notice.classList.contains("is-hidden");
  notice.classList.remove("is-highlighted");
  notice.classList.toggle("is-hidden", !willShow);
  notice.setAttribute("aria-hidden", String(!willShow));
  event.currentTarget.setAttribute("aria-expanded", String(willShow));
  if (willShow) {
    notice.scrollIntoView({ behavior: "smooth", block: "start" });
    requestAnimationFrame(() => {
      notice.classList.add("is-highlighted");
      window.setTimeout(() => notice.classList.remove("is-highlighted"), 1400);
    });
  }
});
document.addEventListener("click", (event) => {
  const searchWrap = event.target.closest(".search-wrap");
  if (!searchWrap) $("search-results").style.display = "none";
});
$("stock-search").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    $("search-results").style.display = "none";
    $("stock-search").blur();
  }
});

$("watch-button").addEventListener("click", () => {
  const code = state.selectedCode;
  state.watchlist = state.watchlist.includes(code) ? state.watchlist.filter((item) => item !== code) : [...state.watchlist, code];
  saveWatchlist();
  render();
});

$("watchlist-toggle").addEventListener("click", () => $("watchlist-panel").classList.toggle("open"));
$("watchlist-close").addEventListener("click", () => $("watchlist-panel").classList.remove("open"));
$("watchlist-items").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-code]");
  if (button) selectStock(button.dataset.code);
});

document.querySelectorAll(".mode-option").forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    render();
  });
});

window.addEventListener("resize", () => {
  render();
  requestAnimationFrame(layoutAnalysisMasonry);
});
render();
