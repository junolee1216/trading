window.AnalysisEngine = (() => {
  const modeProfiles = {
    short: {
      label: "단기 투자",
      description: "기술적 흐름과 수급 변화를 더 크게 반영합니다.",
      weights: { technical: 38, fundamental: 15, flow: 25, news: 12, market: 10 }
    },
    balanced: {
      label: "중장기 투자",
      description: "기술, 재무, 수급, 뉴스, 시장 상황을 기본 비중으로 반영합니다.",
      weights: { technical: 30, fundamental: 25, flow: 20, news: 15, market: 10 }
    },
    value: {
      label: "가치 투자",
      description: "PER, PBR, ROE, 성장률과 재무 안정성을 더 크게 반영합니다.",
      weights: { technical: 18, fundamental: 42, flow: 15, news: 15, market: 10 }
    },
    dividend: {
      label: "배당 투자",
      description: "배당수익률, 재무 안정성, 변동성, 시장 방어력을 더 중시합니다.",
      weights: { technical: 20, fundamental: 35, flow: 15, news: 15, market: 15 }
    }
  };

  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const last = (values) => values[values.length - 1];
  const formatSigned = (value) => `${value > 0 ? "+" : ""}${value.toLocaleString()}억`;
  const hasNumber = (value) => Number.isFinite(Number(value));
  const formatNumber = (value, suffix = "") => (hasNumber(value) ? `${Number(value).toLocaleString()}${suffix}` : "자료 없음");
  const formatPercent = (value) => (hasNumber(value) ? `${Number(value).toFixed(2)}%` : "자료 없음");

  function movingAverage(values, period) {
    if (values.length < period) return mean(values);
    return mean(values.slice(-period));
  }

  function calculateRsi(values, period = 14) {
    if (values.length <= period) return 50;
    const slice = values.slice(-(period + 1));
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < slice.length; i += 1) {
      const diff = slice[i] - slice[i - 1];
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }

  function calculateMacd(values) {
    const ema = (period) => movingAverage(values, Math.min(period, values.length));
    const macd = ema(12) - ema(26);
    const signal = macd * 0.82;
    return { macd, signal, histogram: macd - signal };
  }

  function bollinger(values) {
    const sample = values.slice(-20);
    const center = mean(sample);
    const variance = mean(sample.map((value) => (value - center) ** 2));
    const sd = Math.sqrt(variance);
    return { upper: center + sd * 2, middle: center, lower: center - sd * 2 };
  }

  function signalTag(scoreRatio) {
    if (scoreRatio >= 0.68) return { label: "매수 신호", tone: "buy" };
    if (scoreRatio <= 0.38) return { label: "매도 신호", tone: "sell" };
    return { label: "중립", tone: "hold" };
  }

  function technical(stock) {
    const prices = stock.prices;
    const current = last(prices);
    const ma5 = movingAverage(prices, 5);
    const ma20 = movingAverage(prices, 20);
    const ma60 = movingAverage(prices, Math.min(60, prices.length));
    const ma120 = movingAverage(prices, Math.min(120, prices.length));
    const rsi = calculateRsi(prices);
    const macd = calculateMacd(prices);
    const bands = bollinger(prices);
    const avgVolume = mean(stock.volumes.slice(-20));
    const volChange = avgVolume > 0 ? ((last(stock.volumes) - avgVolume) / avgVolume) * 100 : 0;
    const weekRange = stock.weekHigh - stock.weekLow;
    const position52 = weekRange > 0 ? ((current - stock.weekLow) / weekRange) * 100 : 50;

    let raw = 0;
    const items = [];

    const maScore = current > ma20 ? (ma20 > ma60 ? 18 : 13) : current > ma5 ? 9 : 4;
    raw += maScore;
    items.push({ name: "이동평균선", value: `5일 ${Math.round(ma5).toLocaleString()} / 20일 ${Math.round(ma20).toLocaleString()}`, detail: current > ma20 ? "주가가 20일선 위에 있어 단기 회복 신호입니다." : "주가가 20일선 아래에 있어 추세 확인이 필요합니다.", score: maScore, max: 18 });

    const rsiScore = rsi < 30 ? 14 : rsi < 55 ? 11 : rsi <= 70 ? 8 : 4;
    raw += rsiScore;
    items.push({ name: "RSI", value: rsi.toFixed(1), detail: rsi < 30 ? "과매도 구간에 가까워 반등 가능성을 점검합니다." : rsi > 70 ? "과열 구간에 가까워 단기 부담이 있습니다." : "과열과 과매도 사이의 중립 구간입니다.", score: rsiScore, max: 14 });

    const macdScore = macd.histogram > 0 ? 10 : 4;
    raw += macdScore;
    items.push({ name: "MACD", value: macd.histogram.toFixed(0), detail: macd.histogram > 0 ? "MACD가 신호선 위라 모멘텀이 우호적입니다." : "MACD 모멘텀이 약해 확인이 필요합니다.", score: macdScore, max: 10 });

    const bandScore = current < bands.lower ? 8 : current < bands.upper ? 7 : 3;
    raw += bandScore;
    items.push({ name: "볼린저밴드", value: `${Math.round(bands.lower).toLocaleString()} ~ ${Math.round(bands.upper).toLocaleString()}`, detail: current > bands.upper ? "상단 밴드 돌파로 단기 과열 가능성이 있습니다." : "밴드 안에서 움직여 변동성은 관리 가능한 수준입니다.", score: bandScore, max: 8 });

    const volScore = volChange > 15 && stock.changeRate > 0 ? 8 : volChange < -20 ? 3 : 6;
    raw += volScore;
    items.push({ name: "거래량 변화", value: `${volChange.toFixed(1)}%`, detail: volChange > 15 ? "거래량이 평균보다 증가해 신호 신뢰도를 보강합니다." : "거래량 변화가 크지 않아 신호 확인이 필요합니다.", score: volScore, max: 8 });

    const positionScore = position52 < 25 ? 7 : position52 < 75 ? 8 : 4;
    raw += positionScore;
    items.push({ name: "52주 위치", value: `${position52.toFixed(0)}%`, detail: position52 > 80 ? "52주 고점에 가까워 차익 실현 리스크가 있습니다." : "최근 고점 대비 여유가 있어 가격 부담은 제한적입니다.", score: positionScore, max: 8 });

    return {
      raw,
      max: 66,
      indicators: { ma5, ma20, ma60, ma120, rsi, macd, bands, volChange, position52 },
      items
    };
  }

  function fundamental(stock) {
    const f = stock.fundamentals;
    const avg = stock.sectorAverage;
    const valued = (value) => value !== null && value !== undefined;
    const neutral = (max) => Math.round(max * 0.52);
    const checks = [
      ["PER", f.per, avg.per, valued(f.per) ? (f.per <= 12 ? 8 : f.per <= 25 ? 6 : 3) : neutral(9), valued(f.per) ? "네이버 증권 제공 PER 기준입니다." : "PER 미확인은 중립으로 반영합니다."],
      ["PBR", f.pbr, avg.pbr, valued(f.pbr) ? (f.pbr <= 1 ? 8 : f.pbr <= 3 ? 5 : 3) : neutral(9), valued(f.pbr) ? "네이버 증권 제공 PBR 기준입니다." : "PBR 미확인은 중립으로 반영합니다."],
      ["ROE", f.roe, avg.roe, valued(f.roe) ? (f.roe > 12 ? 8 : f.roe > 0 ? 5 : 2) : neutral(9), valued(f.roe) ? "자기자본이익률을 반영합니다." : "ROE 미확인은 중립으로 반영합니다."],
      ["매출 성장률", f.revenueGrowth, avg.revenueGrowth, valued(f.revenueGrowth) ? (f.revenueGrowth > 10 ? 8 : f.revenueGrowth > 0 ? 5 : 2) : neutral(9), valued(f.revenueGrowth) ? "성장 지속성을 확인합니다." : "성장률 미확인은 중립으로 반영합니다."],
      ["영업이익 성장률", f.opGrowth, avg.opGrowth, valued(f.opGrowth) ? (f.opGrowth > 10 ? 8 : f.opGrowth > 0 ? 5 : 2) : neutral(9), valued(f.opGrowth) ? "이익 모멘텀을 반영합니다." : "영업이익 성장률 미확인은 중립으로 반영합니다."],
      ["순이익 성장률", f.netGrowth, avg.netGrowth, valued(f.netGrowth) ? (f.netGrowth > 10 ? 7 : f.netGrowth > 0 ? 4 : 2) : neutral(9), valued(f.netGrowth) ? "순이익 방향성을 반영합니다." : "순이익 성장률 미확인은 중립으로 반영합니다."],
      ["부채비율", f.debtRatio, avg.debtRatio, valued(f.debtRatio) ? (f.debtRatio < 80 ? 7 : f.debtRatio < 150 ? 5 : 2) : neutral(9), valued(f.debtRatio) ? "재무 안정성을 확인합니다." : "부채비율 미확인은 중립으로 반영합니다."],
      ["영업이익률", f.opMargin, avg.opMargin, valued(f.opMargin) ? (f.opMargin > 15 ? 7 : f.opMargin > 0 ? 4 : 2) : neutral(9), valued(f.opMargin) ? "수익성 수준을 반영합니다." : "영업이익률 미확인은 중립으로 반영합니다."],
      ["배당수익률", f.dividendYield, avg.dividendYield, valued(f.dividendYield) ? (f.dividendYield > 2 ? 5 : 3) : neutral(5), valued(f.dividendYield) ? "네이버 증권 제공 배당수익률 기준입니다." : "배당수익률 미확인은 중립으로 반영합니다."],
      ["외국인비율", f.foreignRatio, null, valued(f.foreignRatio) ? (f.foreignRatio > 40 ? 5 : f.foreignRatio > 15 ? 4 : 2) : neutral(5), valued(f.foreignRatio) ? "네이버 증권 제공 외국인 소진율 기준입니다." : "외국인 비율 미확인은 중립으로 반영합니다."]
    ];
    const raw = checks.reduce((sum, item) => sum + item[3], 0);
    return {
      raw,
      max: 74,
      missing: Object.values(f).filter((value) => value === null || value === undefined).length,
      items: checks.map(([name, value, average, score, detail]) => ({
        name,
        value: value === null || value === undefined ? "자료 없음" : `${value}${name.includes("비율") || name.includes("률") || name === "ROE" ? "%" : "배"}`,
        detail,
        score,
        max: name === "배당수익률" ? 5 : 9,
        tag: value === null || value === undefined ? { label: "중립 반영", tone: "hold" } : signalTag(score / (name === "배당수익률" || name === "외국인비율" ? 5 : 9))
      }))
    };
  }

  function flow(stock) {
    const f = stock.flows;
    if (f.available === false) {
      return {
        raw: 35,
        max: 70,
        together: "투자자별 수급 데이터는 미확인 상태라 중립으로 반영합니다.",
        unavailable: true,
        items: [
          { name: "개인", d1: null, d5: null, d20: null },
          { name: "외국인", d1: null, d5: null, d20: null },
          { name: "기관", d1: null, d5: null, d20: null }
        ]
      };
    }
    const foreignInstitutionTogether = f.foreign.d5 > 0 && f.institution.d5 > 0;
    const togetherSell = f.foreign.d5 < 0 && f.institution.d5 < 0;
    let raw = 28;
    if (foreignInstitutionTogether) raw += 28;
    if (togetherSell) raw -= 18;
    if (f.foreign.d20 > 0) raw += 10;
    if (f.institution.d20 > 0) raw += 8;
    raw = clamp(raw, 0, 70);
    return {
      raw,
      max: 70,
      together: foreignInstitutionTogether ? "외국인과 기관이 5거래일 동반 순매수입니다." : togetherSell ? "외국인과 기관이 5거래일 동반 순매도입니다." : "투자자별 수급 방향이 엇갈립니다.",
      items: [
        { name: "개인", d1: f.individual.d1, d5: f.individual.d5, d20: f.individual.d20 },
        { name: "외국인", d1: f.foreign.d1, d5: f.foreign.d5, d20: f.foreign.d20 },
        { name: "기관", d1: f.institution.d1, d5: f.institution.d5, d20: f.institution.d20 }
      ]
    };
  }

  function news(stock) {
    if (!stock.news.length && !stock.disclosures.length) {
      return { raw: 30, max: 60, items: [], disclosures: [], unavailable: true };
    }
    let raw = 35;
    stock.news.forEach((item) => {
      if (item.sentiment === "긍정") raw += 12;
      if (item.sentiment === "부정") raw -= 12;
    });
    stock.disclosures.forEach((item) => {
      if (item.impact === "리스크") raw -= 8;
      if (item.impact === "기회") raw += 8;
    });
    return { raw: clamp(raw, 0, 60), max: 60, items: stock.news, disclosures: stock.disclosures };
  }

  function marketScore(stock, market) {
    let raw = 30;
    raw += market.kospi.trend === "weak" ? -5 : 5;
    raw += market.kosdaq.trend === "weak" ? -4 : 3;
    raw += market.usdkrw.signal === "부담" ? -4 : 2;
    raw += market.baseRate.signal === "부담" ? -2 : 2;
    const sectorBoost = stock.sector === "반도체" ? 8 : stock.sector === "인터넷" ? -4 : 0;
    raw += sectorBoost;
    return {
      raw: clamp(raw, 0, 50),
      max: 50,
      items: [
        { name: "KOSPI", value: `${formatNumber(market.kospi.level)} (${formatPercent(market.kospi.changeRate)})`, detail: market.kospi.trend === "weak" ? "지수 흐름이 약해 보수적으로 반영합니다." : "지수 흐름이 안정적입니다." },
        { name: "KOSDAQ", value: `${formatNumber(market.kosdaq.level)} (${formatPercent(market.kosdaq.changeRate)})`, detail: "중소형주 투자심리를 함께 확인합니다." },
        { name: "환율", value: `${formatNumber(market.usdkrw.value, "원")}`, detail: `환율은 ${market.usdkrw.signal || "중립"} 요인입니다.` },
        { name: "기준금리", value: formatPercent(market.baseRate.value), detail: `한국은행 기준금리 기준입니다. 금리 환경은 ${market.baseRate.signal || "중립"}으로 반영합니다.` },
        { name: "업종 흐름", value: stock.sector, detail: sectorBoost > 0 ? "업종 모멘텀이 개별 종목 판단을 보강합니다." : sectorBoost < 0 ? "업종 투자심리가 약해 보수적으로 반영합니다." : "업종 흐름은 중립입니다." },
        { name: "투자심리", value: market.kospi.turnover, detail: market.sentiment }
      ]
    };
  }

  function confidence(stock, sections, totalScore) {
    const missingPenalty = sections.fundamental.missing * 3;
    const unavailablePenalty = (sections.flow.unavailable ? 7 : 0) + (sections.news.unavailable ? 6 : 0);
    const volatility = Math.abs(stock.changeRate) + Math.abs(sections.technical.indicators.volChange) / 10;
    const sectionScores = [sections.technical, sections.fundamental, sections.flow, sections.news, sections.market].map((section) => section.raw / section.max);
    const agreement = 1 - (Math.max(...sectionScores) - Math.min(...sectionScores));
    let score = 78 - missingPenalty - unavailablePenalty - volatility + agreement * 18;
    if (totalScore >= 40 && totalScore < 70) score -= 4;
    score = clamp(score, 20, 95);
    if (score >= 72) return { label: "신뢰도 높음", score };
    if (score >= 50) return { label: "신뢰도 보통", score };
    return { label: "신뢰도 낮음", score, warning: "데이터 부족 또는 지표 간 충돌로 인해 판단 신뢰도가 낮습니다." };
  }

  function signalFromTotal(total) {
    if (total >= 78) return { signal: "강한 매수 고려", tone: "strong-buy", label: "상승 우위가 뚜렷한 구간" };
    if (total >= 64) return { signal: "매수 고려", tone: "buy", label: "매수 쪽 근거가 조금 더 우세한 구간" };
    if (total >= 52) return { signal: "보유/관망", tone: "hold", label: "신호가 엇갈려 확인이 필요한 구간" };
    if (total >= 44) return { signal: "매도 주의", tone: "caution", label: "하락 또는 리스크 근거가 우세한 구간" };
    return { signal: "매도 고려", tone: "sell", label: "방어적 판단이 필요한 구간" };
  }

  function sectionName(key) {
    return {
      technical: "기술적 분석",
      fundamental: "기본적 분석",
      flow: "수급 분석",
      news: "뉴스/공시",
      market: "시장 상황"
    }[key] || key;
  }

  function sectionReason(key, score, weight, sections, stock) {
    if (key === "technical") {
      const indicators = sections.technical.indicators;
      const trend = stock.price >= indicators.ma20 ? "20일 이동평균선 위" : "20일 이동평균선 아래";
      return `기술적 분석은 ${score.toFixed(1)}/${weight}점입니다. 현재가는 ${trend}에 있고 RSI는 ${indicators.rsi.toFixed(1)}, 거래량 변화는 ${indicators.volChange.toFixed(1)}%로 반영됐습니다.`;
    }
    if (key === "fundamental") {
      return `기본적 분석은 ${score.toFixed(1)}/${weight}점입니다. PER/PBR/ROE 등 미확인 재무 항목 ${sections.fundamental.missing}개는 판단 신뢰도를 낮추고 중립으로 반영했습니다.`;
    }
    if (key === "flow") {
      return `수급 분석은 ${score.toFixed(1)}/${weight}점입니다. ${sections.flow.together}`;
    }
    if (key === "news") {
      return sections.news.unavailable
        ? `뉴스/공시는 ${score.toFixed(1)}/${weight}점입니다. 연결된 뉴스와 공시가 부족해 기회·리스크 판단은 중립으로 제한했습니다.`
        : `뉴스/공시는 ${score.toFixed(1)}/${weight}점입니다. 긍정/부정 뉴스와 공시 영향을 점수에 반영했습니다.`;
    }
    return `시장 상황은 ${score.toFixed(1)}/${weight}점입니다. KOSPI, KOSDAQ, 환율, 금리, 업종 흐름을 개별 종목 점수에 함께 반영했습니다.`;
  }

  function buildReasons(stock, sections, weighted, profile, total, signalInfo, dataLimited) {
    const entries = Object.keys(profile.weights).map((key) => ({
      key,
      score: weighted[key],
      weight: profile.weights[key],
      ratio: weighted[key] / profile.weights[key]
    }));
    const technicalEntry = entries.find((entry) => entry.key === "technical");
    const weakest = [...entries].filter((entry) => entry.key !== "technical").sort((a, b) => a.ratio - b.ratio)[0];
    const reasons = [
      `종합 점수는 ${total.toFixed(1)}점입니다. 78점 이상은 강한 매수 고려, 64~77점은 매수 고려, 52~63점은 보유/관망, 44~51점은 매도 주의, 44점 미만은 매도 고려로 분류하며 현재 신호는 '${signalInfo.signal}'입니다.`,
      sectionReason("technical", technicalEntry.score, technicalEntry.weight, sections, stock),
      dataLimited
        ? `재무 미확인 항목 ${sections.fundamental.missing}개, 수급 데이터 미연결, 뉴스/공시 부족이 신뢰도 제한 요인입니다. 이 부족 데이터는 매수 또는 매도 쪽으로 억지 반영하지 않고 중립 및 보수 조정으로 처리했습니다.`
        : sectionReason(weakest.key, weakest.score, weakest.weight, sections, stock)
    ];

    return reasons;
  }

  function priceZone(value) {
    return `${Math.round(value).toLocaleString()}원`;
  }

  function priceDiffPercent(from, to) {
    if (!from) return 0;
    return ((to - from) / from) * 100;
  }

  function buildForecast(stock, sections, total, signalInfo) {
    const prices = stock.prices;
    const current = last(prices);
    const recent5 = priceDiffPercent(prices.at(-6) || prices[0], current);
    const recent20 = priceDiffPercent(prices.at(-21) || prices[0], current);
    const { ma5, ma20, ma60, rsi, macd, bands, volChange, position52 } = sections.technical.indicators;
    const support = Math.min(...prices.slice(-20));
    const resistance = Math.max(...prices.slice(-20));
    const pullbackZone = Math.max(support, Math.min(ma20, bands.middle));
    const reboundZone = Math.max(support, Math.min(ma5, ma20));
    const breakoutZone = resistance * 1.01;

    const rising = current >= ma20 && ma20 >= ma60 && recent5 >= 0;
    const falling = current < ma20 && recent5 < 0;
    const overheated = rsi >= 70 || position52 >= 82 || current >= bands.upper;
    const oversold = rsi <= 35 || current <= bands.lower;
    const momentumPositive = macd.histogram > 0 && volChange > -10;

    let direction = "횡보/확인 구간";
    let nearTerm = "단기 방향이 뚜렷하지 않아 20일선 회복 또는 이탈을 먼저 확인하는 구간입니다.";
    let pullback = "20일선과 최근 지지선 사이에서 거래량이 줄어드는지 확인하는 것이 좋습니다.";
    let buyTiming = "가격이 20일선 위로 회복하고 거래량이 20일 평균보다 증가할 때 분할 매수 검토 구간으로 봅니다.";
    let sellTiming = "최근 지지선을 종가 기준으로 이탈하거나 점수가 44점 아래로 내려가면 매도 고려 신호가 강해집니다.";

    if (rising) {
      direction = overheated ? "상승 중이나 단기 과열" : "상승 추세 우위";
      nearTerm = overheated
        ? `RSI ${rsi.toFixed(1)}와 52주 위치 ${position52.toFixed(0)}%를 보면 1~5거래일 안에 차익 실현성 조정 가능성을 봐야 합니다.`
        : `20일선 위에서 상승 흐름이 유지되고 있어 단기 추세는 우호적입니다. 다만 저항선 ${priceZone(resistance)} 부근에서는 속도 조절 가능성이 있습니다.`;
      pullback = `상승 중 추격 매수보다는 ${priceZone(pullbackZone)} 부근 조정 후 지지 확인을 우선 봅니다.`;
      buyTiming = `현재가가 조정받아도 ${priceZone(ma20)} 전후를 지키고 다시 양봉/거래량 증가가 나오면 매수 고려 타이밍으로 분류합니다.`;
      sellTiming = `${priceZone(resistance)} 돌파 실패 후 거래량이 감소하거나, 종가가 ${priceZone(ma20)} 아래로 내려가면 단기 매도 주의로 전환합니다.`;
    } else if (falling) {
      direction = oversold ? "하락 중이나 반등 감시" : "하락 추세 우위";
      nearTerm = oversold
        ? `RSI ${rsi.toFixed(1)}로 과매도권에 가까워 기술적 반등은 가능하지만, 추세 전환 확인 전에는 신중한 구간입니다.`
        : `현재가가 20일선 아래에 있어 하락 압력이 남아 있습니다. 바로 매수하기보다 반등 확인이 필요합니다.`;
      pullback = `추가 하락 시 ${priceZone(support)} 부근에서 지지 여부를 우선 확인합니다. 이 가격대를 종가 기준 이탈하면 리스크가 커집니다.`;
      buyTiming = `최소 조건은 ${priceZone(reboundZone)} 위 회복, RSI 40 이상 회복, 거래량 증가입니다. 이 조건이 같이 나올 때만 매수 검토로 봅니다.`;
      sellTiming = `${priceZone(support)} 이탈 또는 외국인/기관 순매도 지속 시 반등보다 방어를 우선하는 구간입니다.`;
    } else if (momentumPositive) {
      direction = "반등 확인 구간";
      nearTerm = `MACD 모멘텀이 개선되고 있어 ${priceZone(breakoutZone)} 돌파 여부가 다음 방향 판단 기준입니다.`;
      pullback = `돌파 전에는 ${priceZone(ma20)} 부근에서 지지를 확인하는 접근이 더 보수적입니다.`;
      buyTiming = `${priceZone(breakoutZone)} 위에서 종가가 유지되고 거래량이 증가하면 매수 고려 쪽 근거가 강화됩니다.`;
      sellTiming = `${priceZone(ma20)} 아래로 다시 밀리면 반등 실패 가능성을 반영해 관망 또는 매도 주의로 봅니다.`;
    }

    return {
      direction,
      horizon: "단기 1~20거래일 기준",
      nearTerm,
      pullback,
      buyTiming,
      sellTiming,
      levels: [
        { label: "현재가", value: priceZone(current) },
        { label: "20일선", value: priceZone(ma20) },
        { label: "지지선", value: priceZone(support) },
        { label: "저항선", value: priceZone(resistance) }
      ],
      watchPoints: [
        `최근 5거래일 등락률 ${recent5 > 0 ? "+" : ""}${recent5.toFixed(2)}%, 20거래일 등락률 ${recent20 > 0 ? "+" : ""}${recent20.toFixed(2)}%입니다.`,
        `RSI ${rsi.toFixed(1)}, MACD 히스토그램 ${macd.histogram.toFixed(0)}, 거래량 변화 ${volChange.toFixed(1)}%를 함께 봅니다.`,
        `현재 신호는 '${signalInfo.signal}'이지만 예측 신뢰도는 ${total >= 64 && !overheated ? "상승 조건 확인" : "조건부 확인"}으로 해석합니다.`
      ]
    };
  }

  function analyze(stock, market, mode = "balanced") {
    const profile = modeProfiles[mode] || modeProfiles.balanced;
    const sections = {
      technical: technical(stock),
      fundamental: fundamental(stock),
      flow: flow(stock),
      news: news(stock)
    };
    sections.market = marketScore(stock, market);

    const weighted = Object.fromEntries(
      Object.entries(profile.weights).map(([key, weight]) => [key, (sections[key].raw / sections[key].max) * weight])
    );
    let total = Object.values(weighted).reduce((sum, score) => sum + score, 0);
    const dataLimited = sections.flow.unavailable && sections.news.unavailable;
    if (dataLimited) {
      const technicalRatio = sections.technical.raw / sections.technical.max;
      const fundamentalRatio = sections.fundamental.raw / sections.fundamental.max;
      const technicalTilt = (technicalRatio - 0.55) * 42;
      const fundamentalTilt = (fundamentalRatio - 0.52) * 14;
      const priceMomentumTilt = stock.changeRate > 2 ? 3 : stock.changeRate < -2 ? -3 : 0;
      total += technicalTilt + fundamentalTilt + priceMomentumTilt;
    }
    if (sections.market.raw / sections.market.max < 0.45 && total >= 70) total -= 5;
    total = clamp(total, 0, 100);

    const signalInfo = signalFromTotal(total);
    const conf = confidence(stock, sections, total);
    const reasons = buildReasons(stock, sections, weighted, profile, total, signalInfo, dataLimited);

    const risks = [];
    if (sections.technical.indicators.position52 > 80) risks.push("52주 고점에 가까워 단기 급등 후 조정 가능성이 있습니다.");
    if (sections.technical.indicators.volChange < -20) risks.push("거래량이 평균보다 낮아 신호 신뢰도가 약해질 수 있습니다.");
    if (stock.fundamentals.opGrowth < 0) risks.push("영업이익 성장률 둔화 또는 감소가 리스크로 반영되었습니다.");
    if (stock.fundamentals.debtRatio > stock.sectorAverage.debtRatio) risks.push("부채비율이 업종 평균보다 높아 재무 부담을 확인해야 합니다.");
    if (stock.flows.foreign.d5 < 0 && stock.flows.institution.d5 < 0) risks.push("외국인과 기관의 동반 순매도가 수급 부담입니다.");
    if (stock.news.some((item) => item.sentiment === "부정")) risks.push("부정적 뉴스가 단기 투자심리에 영향을 줄 수 있습니다.");
    if (market.kospi.trend === "weak") risks.push("KOSPI 흐름이 약해 개별 종목 신호를 보수적으로 해석해야 합니다.");
    if (market.usdkrw.signal === "부담") risks.push("환율 상승이 비용 또는 투자심리 부담으로 작용할 수 있습니다.");
    if (stock.disclosures.length) risks.push("공시 내용은 추가 확인이 필요한 불확실성 요인입니다.");
    if (!risks.length) risks.push("현재 샘플 데이터 기준으로 큰 단기 리스크는 제한적이나 시장 변동성은 계속 확인해야 합니다.");

    const forecast = buildForecast(stock, sections, total, signalInfo);

    return { profile, sections, weighted, total, signal: signalInfo.signal, tone: signalInfo.tone, confidence: conf, reasons, risks, forecast };
  }

  return { analyze, modeProfiles, movingAverage, formatSigned };
})();
