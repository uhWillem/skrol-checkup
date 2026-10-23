import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import type { JobStore } from "./jobs.js";
import { CHECKS, type Finding } from "./types.js";
import type { UrlGuard } from "./url-guard.js";

export const VERSION = "0.1.0";
const MAX_PAGES_SHOWN = 20;

/** Welke checklist-punten deze versie automatisch controleert. */
export function coverage(): Array<{ check: string; item: string; category: string }> {
  return Object.values(CHECKS).map((c) => ({ check: c.id, item: c.item, category: c.category }));
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
        "Volg de voortgang op met get_checkup_status.",
      inputSchema: { url: z.string().url().describe("Start-URL van de site, meestal de staging-URL op .webflow.io") },
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: false },
    },
    async ({ url }) => {
      if (!guard.isAllowedPage(url)) {
        return fail(`Domein niet toegestaan: ${new URL(url).hostname}. Toegestaan: ${config.allowedDomains.join(", ")}.`);
      }
      const job = await store.start(url);
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
        "Punten die niet in die lijst staan, moet het team manueel nakijken.",
      inputSchema: { job_id: z.string().describe("ID uit start_checkup") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ job_id }) => {
      const job = store.get(job_id);
      if (!job) return fail(`Onbekende job: ${job_id}`);
      return json(job.status === "done" ? { ...job, version: VERSION, coverage: coverage() } : job);
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

  return server;
}
