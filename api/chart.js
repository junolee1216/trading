export default async function handler(request, response) {
  const { searchParams } = new URL(request.url, `https://${request.headers.host || "localhost"}`);
  const symbol = searchParams.get("symbol");
  const range = searchParams.get("range") || "6mo";
  const interval = searchParams.get("interval") || "1d";

  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (!symbol || !/^[0-9A-Z.]+$/.test(symbol)) {
    response.status(400).json({ error: "Invalid symbol" });
    return;
  }

  const yahooUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`);
  yahooUrl.searchParams.set("range", range);
  yahooUrl.searchParams.set("interval", interval);

  const yahooResponse = await fetch(yahooUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const body = await yahooResponse.text();
  response.status(yahooResponse.status);
  response.setHeader("Content-Type", yahooResponse.headers.get("content-type") || "application/json");
  response.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  response.send(body);
}
