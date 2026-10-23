import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type Config } from "./config.js";
import { JobStore } from "./jobs.js";
import { createMcpServer, VERSION } from "./mcp.js";
import { UrlGuard } from "./url-guard.js";

const MAX_BODY = 1_000_000;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body te groot"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Met API_KEY ingesteld moet elke aanroep de sleutel meesturen (x-api-key of Authorization: Bearer). */
export function authorized(req: IncomingMessage, apiKey: string): boolean {
  if (!apiKey) return true;
  const header = req.headers["x-api-key"];
  if (typeof header === "string" && sameSecret(header, apiKey)) return true;
  const auth = req.headers.authorization ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  return !!bearer && sameSecret(bearer.trim(), apiKey);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function startServer(config: Config = loadConfig()) {
  const guard = new UrlGuard(config.allowedDomains, config.allowPrivateNetworks);
  const store = new JobStore(config, guard);
  await store.load();

  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/healthz") return send(res, 200, { ok: true, version: VERSION });
    if (url.pathname !== config.mcpPath) return send(res, 404, { error: "niet gevonden" });
    if (!authorized(req, config.apiKey)) return send(res, 401, { error: "niet geautoriseerd" });
    if (req.method !== "POST") {
      // Stateless server: geen sessies, dus geen GET-stream of DELETE.
      return send(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
    }
    try {
      const body = await readBody(req);
      // Elke aanroep krijgt een eigen server en transport; de jobs leven in de gedeelde store.
      const server = createMcpServer(store, config, guard);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent) send(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: (error as Error).message }, id: null });
    }
  });

  await new Promise<void>((resolve) => http.listen(config.port, config.host, resolve));
  const address = http.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  return { http, store, port };
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("server.js");
if (isMain) {
  const config = loadConfig();
  startServer(config).then(({ port }) => {
    console.log(`skrol-checkup ${VERSION} luistert op poort ${port}, pad ${config.mcpPath}`);
    console.log(`Toegestane domeinen: ${config.allowedDomains.join(", ")}`);
    if (!config.apiKey) console.log("Let op: geen API_KEY ingesteld; enkel de firewall beschermt de server.");
  });
}
