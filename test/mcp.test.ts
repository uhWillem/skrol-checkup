import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startServer } from "../src/server.js";
import { startExternal, startSite, testConfig } from "./helpers.js";

let site: { server: Server; origin: string };
let external: { server: Server; origin: string };
let mcp: Awaited<ReturnType<typeof startServer>>;
let endpoint: URL;
const API_KEY = "test-sleutel";

async function connect(headers: Record<string, string> = { "x-api-key": API_KEY }) {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers } }));
  return client;
}

function parse(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

before(async () => {
  external = await startExternal();
  site = await startSite(external.origin);
  const config = await testConfig({ API_KEY, MCP_PATH: "/mcp-test" });
  config.port = 0;
  config.host = "127.0.0.1";
  mcp = await startServer(config);
  endpoint = new URL(`http://127.0.0.1:${mcp.port}/mcp-test`);
});

after(() => {
  mcp.http.close();
  site.server.close();
  external.server.close();
});

test("zonder API-sleutel geweigerd", async () => {
  await assert.rejects(connect({}));
});

test("toont de drie tools", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["get_checkup_status", "get_findings", "get_screenshot", "list_pages", "start_checkup"]);
  await client.close();
});

test("niet-toegestaan domein wordt meteen geweigerd", async () => {
  const client = await connect();
  const result = await client.callTool({ name: "start_checkup", arguments: { url: "https://example.com/" } });
  assert.equal(result.isError, true);
  await client.close();
});

test("volledige check-up: starten, opvolgen, bevindingen ophalen", async () => {
  const client = await connect();
  const started = parse(await client.callTool({ name: "start_checkup", arguments: { url: `${site.origin}/` } }));
  assert.match(started.job_id, /^job_/);

  let status;
  for (let i = 0; i < 120; i++) {
    status = parse(await client.callTool({ name: "get_checkup_status", arguments: { job_id: started.job_id } }));
    if (status.status === "done" || status.status === "failed") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(status.status, "done", status.error);
  assert.equal(status.summary.pages, 9);
  assert.ok(status.coverage.length >= 10);

  const first = parse(await client.callTool({ name: "get_findings", arguments: { job_id: started.job_id, limit: 5 } }));
  assert.equal(first.findings.length, 5);
  assert.equal(first.next_offset, 5);
  assert.equal(first.total, status.summary.findings);
  assert.equal(first.findings[0].hint, "hoog");

  const links = parse(await client.callTool({ name: "get_findings", arguments: { job_id: started.job_id, check: "broken-links" } }));
  assert.equal(links.total, 5);

  const page = parse(await client.callTool({ name: "get_findings", arguments: { job_id: started.job_id, page: "/formulier" } }));
  assert.ok(page.findings.every((f: { pages: string[] }) => f.pages.includes("/formulier")));

  const pages = parse(await client.callTool({ name: "list_pages", arguments: { job_id: started.job_id } }));
  assert.equal(pages.total, 9);
  assert.ok(pages.pages.some((p: { path: string; status: number }) => p.path === "/bestaat-niet" && p.status === 404));
  assert.ok(pages.sections.some((s: { section: string }) => s.section === "/layout"));
  await client.close();
});

test("ongeldig live domein wordt meteen geweigerd", async () => {
  const client = await connect();
  const result = await client.callTool({ name: "start_checkup", arguments: { url: `${site.origin}/`, live_domain: "geen domein" } });
  assert.equal(result.isError, true);
  await client.close();
});

function image(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  return { meta: JSON.parse(content[0].text!), image: content.find((c) => c.type === "image") };
}

test("screenshot van de volledige pagina, in delen", async () => {
  const client = await connect();
  const result = await client.callTool({ name: "get_screenshot", arguments: { url: `${site.origin}/layout`, width: 390 } });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  const { meta, image: img } = image(result);
  assert.equal(img?.mimeType, "image/jpeg");
  assert.ok((img?.data?.length ?? 0) > 1000);
  assert.equal(meta.width, 390);
  assert.equal(meta.part, 1);
  assert.ok(meta.parts >= 1);
  assert.ok(meta.height <= 1800);
  await client.close();
});

test("screenshot rond een element uit een bevinding", async () => {
  const client = await connect();
  const result = await client.callTool({ name: "get_screenshot", arguments: { url: `${site.origin}/layout`, width: 1440, selector: "div.clip-box" } });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  const { meta, image: img } = image(result);
  assert.equal(meta.selector, "div.clip-box");
  assert.ok(img?.data);
  const missing = await client.callTool({ name: "get_screenshot", arguments: { url: `${site.origin}/layout`, selector: "div.bestaat-niet" } });
  assert.equal(missing.isError, true);
  const foreign = await client.callTool({ name: "get_screenshot", arguments: { url: "https://example.com/" } });
  assert.equal(foreign.isError, true);
  await client.close();
});

test("onbekende job geeft een fout", async () => {
  const client = await connect();
  const result = await client.callTool({ name: "get_checkup_status", arguments: { job_id: "job_bestaat_niet" } });
  assert.equal(result.isError, true);
  await client.close();
});
