import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadConfig, type Config } from "../src/config.js";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "site");

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

/** Een "externe" site op een andere poort, met de statuscodes die de linkcontrole moet herkennen. */
export async function startExternal(): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/ok") return res.writeHead(200, { "content-type": "text/html" }).end("<p>ok</p>");
    if (path === "/redirect") return res.writeHead(301, { location: "/ok" }).end();
    if (path === "/blocked") return res.writeHead(403).end();
    if (path === "/error") return res.writeHead(500).end();
    if (path === "/head-not-allowed") return req.method === "HEAD" ? res.writeHead(405).end() : res.writeHead(200).end("ok");
    return res.writeHead(404).end("weg");
  });
  const port = await listen(server);
  return { server, origin: `http://127.0.0.1:${port}` };
}

/** De testsite: /pad toont pad.html, EXT in de html wordt de URL van de externe site. */
export async function startSite(externalOrigin: string): Promise<{ server: Server; origin: string }> {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/sitemap.xml") {
      return res.writeHead(200, { "content-type": "application/xml" }).end(await readFile(join(SITE, "sitemap.xml")));
    }
    if (/\.(png|svg|jpg)$/.test(path)) {
      return res.writeHead(200, { "content-type": path.endsWith(".svg") ? "image/svg+xml" : "image/png" }).end("");
    }
    const file = join(SITE, `${path === "/" ? "index" : path.slice(1)}.html`);
    if (!existsSync(file)) return res.writeHead(404, { "content-type": "text/html" }).end("<h1>Niet gevonden</h1>");
    const html = (await readFile(file, "utf8")).replaceAll("EXT/", `${externalOrigin}/`);
    return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
  });
  const port = await listen(server);
  return { server, origin: `http://127.0.0.1:${port}` };
}

export async function testConfig(overrides: Record<string, string> = {}): Promise<Config> {
  const dataDir = await mkdtemp(join(tmpdir(), "skrol-checkup-"));
  return loadConfig({
    ALLOWED_DOMAINS: "127.0.0.1",
    ALLOW_PRIVATE_NETWORKS: "true",
    CHROMIUM_EXECUTABLE: process.env.CHROMIUM_EXECUTABLE ?? "",
    DATA_DIR: dataDir,
    PORT: "1",
    LINK_TIMEOUT_MS: "3000",
    ...overrides,
  });
}
