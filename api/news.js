const NEWS_TTL_SECONDS = 180;

function decodeEntities(value = "") {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function stripTags(value = "") {
  return decodeEntities(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function getTag(item, tag) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripTags(match[1]) : "";
}

function newsSearchUrl(title) {
  return `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(title || "코스피 코스닥")}`;
}

function getClickUrl(link, title) {
  if (!link) return newsSearchUrl(title);
  try {
    const hostname = new URL(link).hostname;
    if (hostname.includes("news.google.com")) return newsSearchUrl(title);
  } catch (error) {
    return newsSearchUrl(title);
  }
  return link;
}

function parseRss(xml, source, category) {
  return Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)).slice(0, 8).map(([item]) => {
    const title = getTag(item, "title");
    const link = getTag(item, "link");
    const summary = getTag(item, "description");
    const pubDate = getTag(item, "pubDate");
    return {
      title,
      link,
      clickUrl: getClickUrl(link, title),
      summary: summary || title,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
      source,
      category,
      sentiment: classifySentiment(`${title} ${summary}`),
      impact: classifyImpact(`${title} ${summary}`)
    };
  }).filter((item) => item.title);
}

function classifySentiment(text) {
  const value = text.toLowerCase();
  const negative = ["급락", "하락", "부진", "적자", "리스크", "관세", "침체", "매도", "인하 지연", "긴축", "제재", "소송", "파업"];
  const positive = ["상승", "호조", "수주", "실적 개선", "완화", "인하", "투자", "증설", "돌파", "매수", "성장", "흑자"];
  const negativeCount = negative.filter((word) => value.includes(word)).length;
  const positiveCount = positive.filter((word) => value.includes(word)).length;
  if (negativeCount > positiveCount) return "부정";
  if (positiveCount > negativeCount) return "긍정";
  return "중립";
}

function classifyImpact(text) {
  const value = text.toLowerCase();
  if (/(연준|fomc|금리|환율|달러|트럼프|관세|유가|전쟁|반도체 규제)/i.test(value)) return "시장 변수";
  if (/(실적|매출|영업이익|수주|공급|계약|배당|자사주)/i.test(value)) return "종목 변수";
  return "확인 필요";
}

async function fetchGoogleNews(query, category) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", `${query} when:2d`);
  url.searchParams.set("hl", "ko");
  url.searchParams.set("gl", "KR");
  url.searchParams.set("ceid", "KR:ko");
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) return [];
  return parseRss(await response.text(), "Google News", category);
}

async function fetchFedNews() {
  const response = await fetch("https://www.federalreserve.gov/feeds/press_all.xml", {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  if (!response.ok) return [];
  return parseRss(await response.text(), "Federal Reserve", "거시/연준");
}

function uniqueNews(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.title}|${item.link}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
}

export default async function handler(request, response) {
  const { searchParams } = new URL(request.url, `https://${request.headers.host || "localhost"}`);
  const stockName = searchParams.get("stock") || "";
  const code = searchParams.get("code") || "";
  const sector = searchParams.get("sector") || "";
  const query = searchParams.get("query") || stockName || code || "코스피";

  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  const macroQueries = [
    "연준 FOMC 금리 발표 한국 증시",
    "트럼프 관세 연설 한국 증시",
    "환율 달러 원 코스피 코스닥"
  ];
  const stockQueries = [
    `${query} ${code}`.trim(),
    sector ? `${sector} 업종 증시` : ""
  ].filter(Boolean);

  const settled = await Promise.allSettled([
    ...stockQueries.map((item) => fetchGoogleNews(item, "종목/업종")),
    ...macroQueries.map((item) => fetchGoogleNews(item, "거시/정책")),
    fetchFedNews()
  ]);

  const items = uniqueNews(settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []))).slice(0, 14);
  const sentimentScore = items.reduce((score, item) => score + (item.sentiment === "긍정" ? 1 : item.sentiment === "부정" ? -1 : 0), 0);
  const riskCount = items.filter((item) => item.sentiment === "부정" || item.impact === "시장 변수").length;
  const generatedAt = new Date().toISOString();

  response.status(200);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", `s-maxage=${NEWS_TTL_SECONDS}, stale-while-revalidate=600`);
  response.json({
    generatedAt,
    query,
    code,
    sector,
    summary: {
      sentiment: sentimentScore > 1 ? "긍정 우위" : sentimentScore < -1 ? "부정 우위" : "혼재/중립",
      riskLevel: riskCount >= 6 ? "높음" : riskCount >= 3 ? "보통" : "낮음",
      itemCount: items.length
    },
    items
  });
}
