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
let tradingViewLoadPromise;
let tradingViewRenderId = 0;

function loadTradingViewScript() {
  if (window.TradingView) return Promise.resolve();
  if (tradingViewLoadPromise) return tradingViewLoadPromise;
  tradingViewLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return tradingViewLoadPromise;
}

function renderTradingViewChart(entry) {
  const container = $("tradingview-chart");
  if (!container || !entry?.code) return;
  const renderId = tradingViewRenderId + 1;
  tradingViewRenderId = renderId;
  const symbol = tradingViewSymbol(entry.code);
  const widgetContainerId = `tradingview-widget-${renderId}`;
  container.innerHTML = `<div class="tradingview-status">${entry.name || entry.code} · ${symbol}</div><div class="tradingview-loading">Loading TradingView chart...</div>`;

  loadTradingViewScript()
    .then(() => {
      if (renderId !== tradingViewRenderId || !window.TradingView) return;
      container.innerHTML = `<div class="tradingview-status">${entry.name || entry.code} · ${symbol}</div><div id="${widgetContainerId}" class="tradingview-widget-target"></div>`;
      new window.TradingView.widget({
        autosize: true,
        symbol,
        interval: "D",
        timezone: "Asia/Seoul",
        theme: "light",
        style: "1",
        locale: "kr",
        toolbar_bg: "#f4f7fb",
        enable_publishing: false,
        allow_symbol_change: true,
        hide_side_toolbar: false,
        withdateranges: true,
        details: true,
        hotlist: false,
        calendar: false,
        container_id: widgetContainerId
      });
    })
    .catch(() => {
      container.innerHTML = "<div class=\"tradingview-loading\">TradingView chart could not be loaded. Please check the network connection.</div>";
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
        <small>${hasDetail ? "상세 분석" : "기본 정보"}</small>
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
  signalCard.className = `signal-card ${analysis.tone}`;
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

function drawChart(stock, analysis) {
  const canvas = $("price-chart");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = rect.width * ratio;
  canvas.height = 460 * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);

  const width = rect.width;
  const height = 460;
  const pad = { left: 56, right: 22, top: 26, bottom: 92 };
  const prices = stock.prices;
  const volumes = stock.volumes;
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

  ctx.fillStyle = "#657384";
  ctx.font = "12px Segoe UI";
  [maxPrice, (maxPrice + minPrice) / 2, minPrice].forEach((price) => {
    ctx.fillText(Math.round(price).toLocaleString(), 6, y(price) + 4);
  });

  const maxVolume = Math.max(...volumes);
  volumes.forEach((volume, index) => {
    const barHeight = (volume / maxVolume) * volumeHeight;
    ctx.fillStyle = prices[index] >= (prices[index - 1] || prices[index]) ? "rgba(200, 62, 77, 0.35)" : "rgba(31, 111, 178, 0.35)";
    ctx.fillRect(x(index) - step * 0.28, volumeTop + volumeHeight - barHeight, step * 0.55, barHeight);
  });

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
    ctx.fillRect(cx - step * 0.25, bodyTop, step * 0.5, bodyHeight);
  });

  const ma20Series = prices.map((_, index) => {
    const sample = prices.slice(Math.max(0, index - 19), index + 1);
    return sample.reduce((sum, value) => sum + value, 0) / sample.length;
  });
  ctx.strokeStyle = "#12805c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ma20Series.forEach((value, index) => {
    if (index === 0) ctx.moveTo(x(index), y(value));
    else ctx.lineTo(x(index), y(value));
  });
  ctx.stroke();

  const support = Math.min(...prices.slice(-12));
  const resistance = Math.max(...prices.slice(-12));
  [
    ["지지선", support, "#1f6fb2"],
    ["저항선", resistance, "#a86b00"]
  ].forEach(([label, price, color]) => {
    ctx.strokeStyle = color;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, y(price));
    ctx.lineTo(width - pad.right, y(price));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.fillText(label, width - pad.right - 42, y(price) - 6);
  });

  const signalIndex = prices.length - 5;
  ctx.fillStyle = analysis.tone === "buy" ? "#12805c" : analysis.tone === "sell" ? "#1f6fb2" : "#a86b00";
  ctx.beginPath();
  ctx.arc(x(signalIndex), y(prices[signalIndex]) - 14, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillText(analysis.signal, x(signalIndex) + 10, y(prices[signalIndex]) - 10);
}

function drawUnavailableChart(entry) {
  const canvas = $("price-chart");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = rect.width * ratio;
  canvas.height = 460 * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const width = rect.width;
  const height = 460;
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
  $("stock-market").textContent = `${entry.market || "KOSPI/KOSDAQ"}${entry.sector ? ` · ${entry.sector}` : ""}`;
  $("stock-name").textContent = entry.name;
  $("stock-code").textContent = entry.code;
  $("latest-price").textContent = "TradingView 차트 확인";
  $("change-rate").textContent = "실시간 차트 제공";
  $("change-rate").className = "neutral";
  $("volume").textContent = "차트 내 거래량 확인";
  $("market-cap").textContent = "추가 지표 준비 중";
  $("week-range").textContent = "차트 기간에서 확인";
  $("updated-at").textContent = data.updatedAt;
  $("footer-update").textContent = `종목 목록 업데이트: ${data.updatedAt}`;

  const signalCard = $("signal-card");
  signalCard.className = "signal-card hold decision-panel";
  $("final-signal").textContent = "차트 확인";
  $("total-score").textContent = "정량 점수 제외";
  $("scorebar-fill").style.width = "45%";
  $("scorebar-fill").style.background = "var(--amber)";
  $("confidence").textContent = "참고용 · 현재 화면은 TradingView 실시간 차트를 우선 제공합니다.";
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
  drawUnavailableChart(entry);
  requestAnimationFrame(layoutAnalysisMasonry);

  const watchButton = $("watch-button");
  const watched = state.watchlist.includes(entry.code);
  watchButton.textContent = watched ? "관심 해제" : "관심 추가";
  watchButton.classList.toggle("active", watched);
  renderWatchlist();
}

function render() {
  const detailedStock = data.stocks.find((item) => item.code === state.selectedCode);
  if (!detailedStock) {
    const entry = getStockEntry(state.selectedCode);
    if (entry) {
      renderUnavailable(entry);
      return;
    }
  }
  const stock = detailedStock || getStock();
  const analysis = engine.analyze(stock, data.market, state.mode);
  renderMode();
  renderSummary(stock, analysis);
  renderAnalysis(stock, analysis);
  renderWatchlist();
  renderTradingViewChart(stock);
  drawChart(stock, analysis);
  setupCollapsiblePanels();
  requestAnimationFrame(layoutAnalysisMasonry);
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
