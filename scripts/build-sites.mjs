import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const files = [
  ["index.html", "text/html; charset=utf-8"],
  ["styles.css", "text/css; charset=utf-8"],
  ["stockUniverse.js", "application/javascript; charset=utf-8"],
  ["stockSearchRank.js", "application/javascript; charset=utf-8"],
  ["data.js", "application/javascript; charset=utf-8"],
  ["analysisEngine.js", "application/javascript; charset=utf-8"],
  ["app.js", "application/javascript; charset=utf-8"]
];

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "server"), { recursive: true });
await mkdir(join(dist, ".openai"), { recursive: true });

const assets = Object.fromEntries(
  await Promise.all(
    files.map(async ([path, type]) => {
      const body = await readFile(join(root, path), "utf8");
      return [path, { type, body }];
    })
  )
);

const hosting = await readFile(join(root, ".openai", "hosting.json"), "utf8");
await writeFile(join(dist, ".openai", "hosting.json"), hosting);

const server = `const assets = ${JSON.stringify(assets)};

function response(body, type, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=60"
    }
  });
}

async function chartProxy(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const range = searchParams.get("range") || "6mo";
  const interval = searchParams.get("interval") || "1d";

  if (!symbol || !/^[0-9A-Z.]+$/.test(symbol)) {
    return response(JSON.stringify({ error: "Invalid symbol" }), "application/json; charset=utf-8", 400);
  }

  const yahooUrl = new URL(\`https://query1.finance.yahoo.com/v8/finance/chart/\${symbol}\`);
  yahooUrl.searchParams.set("range", range);
  yahooUrl.searchParams.set("interval", interval);

  const yahooResponse = await fetch(yahooUrl, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  return new Response(await yahooResponse.text(), {
    status: yahooResponse.status,
    headers: {
      "Content-Type": yahooResponse.headers.get("content-type") || "application/json",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/chart") return chartProxy(request);

    const path = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\\//, "");
    const asset = assets[path] || assets["index.html"];
    return response(asset.body, asset.type);
  }
};
`;

await writeFile(join(dist, "server", "index.js"), server);
