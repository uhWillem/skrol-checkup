import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import type { JobStore } from "./jobs.js";
import { CHECKS, type Finding } from "./types.js";
import type { UrlGuard } from "./url-guard.js";
import { normalizeDomain } from "./discover.js";
import { takeScreenshot } from "./screenshot.js";

export const VERSION = "0.5.0";
const MAX_PAGES_SHOWN = 20;

/** Welke checklist-punten deze versie automatisch controleert; controles die niet gelopen hebben tellen niet mee. */
export function coverage(skipped: string[] = []): Array<{ check: string; item: string; category: string }> {
  return Object.values(CHECKS)
    .filter((c) => !skipped.includes(c.id))
    .map((c) => ({ check: c.id, item: c.item, category: c.category }));
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function compact(f: Finding) {
  const { pages, ...rest } = f;
  return { ...rest, pages: pages.slice(0, MAX_PAGES_SHOWN), pageCount: pages.length };
}

export function createMcpServer(store: JobStore, config: Config, guard: UrlGuard): McpServer {
  const server = new McpServer({ name: "skrol-checkup", version: VERSION });

  server.registerTool(
    "start_checkup",
    {
      title: "Check-up starten",
      description:
        "Start een check-up van een Webflow-site als achtergrondtaak en geeft een job-ID terug. " +
        "Geef de staging-URL (bv. https://klant.webflow.io). De tool crawlt alle pagina's van de site, " +
        "controleert ze in Chromium op meerdere schermbreedtes en test alle links. " +
        "Geef live_domain mee als je het live domein van de klant kent: links naar dat domein worden dan op de nieuwe site gecontroleerd. " +
        "Zonder live_domain haalt de tool het uit sitemap.xml als dat kan. " +
        "Volg de voortgang op met get_checkup_status.",
      inputSchema: {
        url: z.string().url().describe("Start-URL van de site, meestal de staging-URL op .webflow.io"),
        live_domain: z
          .string()
          .optional()
          .describe("Live domein van de klant, bv. klant.be. Links naar dit domein tellen als interne links van de nieuwe site."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: false },
    },
    async ({ url, live_domain }) => {
      if (!guard.isAllowedPage(url)) {
        return fail(`Domein niet toegestaan: ${new URL(url).hostname}. Toegestaan: ${config.allowedDomains.join(", ")}.`);
      }
      let liveDomain: string | undefined;
      if (live_domain) {
        liveDomain = normalizeDomain(live_domain) ?? undefined;
        if (!liveDomain) return fail(`Ongeldig live domein: ${live_domain}. Gebruik bv. klant.be.`);
      }
      const job = await store.start(url, { liveDomain });
      return json({ job_id: job.id, status: job.status, message: "Check-up gestart. Vraag de status op met get_checkup_status." });
    },
  );

  server.registerTool(
    "get_checkup_status",
    {
      title: "Status van een check-up",
      description:
        "Geeft de status en voortgang van een check-up. Als ze klaar is, staat er een samenvatting bij " +
        "(aantal bevindingen per prioriteit en per controle) en de lijst checklist-punten die deze versie controleert. " +
        "Punten die niet in die lijst staan, moet het team manueel nakijken. Met een live domein vergelijkt de tool ook de oude site " +
        "(summary.migration); kon dat niet, dan staat de reden in summary.skipped.",
      inputSchema: { job_id: z.string().describe("ID uit start_checkup") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ job_id }) => {
      const job = store.get(job_id);
      if (!job) return fail(`Onbekende job: ${job_id}`);
      if (job.status !== "done") return json(job);
      return json({ ...job, version: VERSION, coverage: coverage((job.summary?.skipped ?? []).map((s) => s.check)) });
    },
  );

  server.registerTool(
    "get_findings",
    {
      title: "Bevindingen ophalen",
      description:
        "Geeft de bevindingen van een afgeronde check-up, gesorteerd op prioriteit (hoog, midden, laag). " +
        "Filter op controle, pagina of prioriteit. Per oproep maximaal 100; gebruik next_offset voor de rest. " +
        "Elke bevinding verwijst naar een punt uit de checklist (item, category) en bevat bewijs (evidence). " +
        "Bevindingen met label 'na te kijken' zijn niet zeker en moeten door een mens bevestigd worden.",
      inputSchema: {
        job_id: z.string(),
        check: z.string().optional().describe("Bv. broken-links, heading-1, horizontal-scroll, image-alt"),
        page: z.string().optional().describe("Pad van de pagina, bv. /diensten"),
        hint: z.enum(["hoog", "midden", "laag"]).optional(),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ job_id, check, page, hint, offset, limit }) => {
      const job = store.get(job_id);
      if (!job) return fail(`Onbekende job: ${job_id}`);
      if (job.status !== "done") return fail(`De check-up is nog niet klaar (status: ${job.status}).`);
      const result = await store.findings(job_id, { check, page, hint, offset, limit });
      if (!result) return fail("Resultaten niet gevonden.");
      return json({ total: result.total, offset: result.offset, next_offset: result.nextOffset, findings: result.findings.map(compact) });
    },
  );

  server.registerTool(
    "list_pages",
    {
      title: "Pagina's van een check-up",
      description:
        "Geeft alle pagina's die een afgeronde check-up gecontroleerd heeft, met statuscode, per sectie gegroepeerd " +
        "(bv. /blog). Handig om per sectie één pagina te kiezen voor get_screenshot.",
      inputSchema: { job_id: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ job_id }) => {
      const job = store.get(job_id);
      if (!job) return fail(`Onbekende job: ${job_id}`);
      const result = await store.result(job_id);
      if (!result) return fail(`De check-up is nog niet klaar (status: ${job.status}).`);
      const sections = new Map<string, number>();
      for (const p of result.pages) {
        const section = p.path === "/" ? "/" : `/${p.path.split("/")[1]}`;
        sections.set(section, (sections.get(section) ?? 0) + 1);
      }
      return json({
        startUrl: result.startUrl,
        total: result.pages.length,
        sections: [...sections.entries()].map(([section, count]) => ({ section, count })),
        pages: result.pages.map((p) => ({
          path: p.path,
          status: p.status,
          ...(p.error ? { error: p.error } : {}),
          ...(p.analysisError ? { analysisError: p.analysisError } : {}),
          ...(p.finalUrl && p.finalUrl !== p.url ? { redirectedTo: p.finalUrl } : {}),
        })),
      });
    },
  );

  server.registerTool(
    "get_screenshot",
    {
      title: "Screenshot van een pagina",
      description:
        "Maakt een screenshot van een pagina op een schermbreedte, zodat je de lay-out zelf kunt bekijken. " +
        "Zonder selector: de volledige pagina in delen; het antwoord zegt hoeveel delen er zijn (parts), vraag de rest op met part. " +
        "Met selector (bv. het element uit een bevinding): enkel het stuk rond dat element, met het element roze omkaderd. " +
        "Gebruik dit om lay-outbevindingen met 'na te kijken' te bevestigen en om pagina's op gsm, tablet en laptop te beoordelen.",
      inputSchema: {
        url: z.string().url().describe("Volledige URL van de pagina, bv. https://klant.webflow.io/diensten"),
        width: z.number().int().min(320).max(1920).optional().describe("Schermbreedte in px, standaard 1440. Bv. 1440, 992, 768, 390."),
        selector: z.string().max(500).optional().describe("CSS-selector van het element, bv. de waarde van element uit een bevinding"),
        part: z.number().int().min(1).optional().describe("Welk deel van de pagina, zonder selector. Standaard 1."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url, width, selector, part }) => {
      if (!guard.isAllowedPage(url)) {
        return fail(`Domein niet toegestaan: ${new URL(url).hostname}. Toegestaan: ${config.allowedDomains.join(", ")}.`);
      }
      try {
        const { image, meta } = await takeScreenshot({ url, width: width ?? 1440, selector, part }, config, guard);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(meta) },
            { type: "image" as const, data: image.toString("base64"), mimeType: "image/jpeg" },
          ],
        };
      } catch (error) {
        return fail(`Screenshot mislukt: ${(error as Error).message.split("\n")[0]}`);
      }
    },
  );

  return server;
}
