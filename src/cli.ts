// Check-up vanaf de commandolijn, zonder MCP: handig om controles lokaal te testen.
// Gebruik: npm run checkup -- https://klant.webflow.io [uitvoer.json]

import { writeFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { runCheckup } from "./runner.js";
import { UrlGuard } from "./url-guard.js";

const [url, out = "checkup-result.json"] = process.argv.slice(2);
if (!url) {
  console.error("Gebruik: npm run checkup -- <url> [uitvoer.json]");
  process.exit(1);
}

const config = loadConfig();
const guard = new UrlGuard(config.allowedDomains, config.allowPrivateNetworks);
const result = await runCheckup(url, config, guard, (p) => process.stderr.write(`\r${p.phase}: ${p.pagesDone}/${p.pagesFound}   `));
process.stderr.write("\n");
await writeFile(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.summary, null, 2));
for (const f of result.findings) console.log(`[${f.hint}] ${f.check} ${f.pages[0]}${f.pages.length > 1 ? ` (+${f.pages.length - 1})` : ""}: ${f.message}`);
console.log(`\nVolledig resultaat: ${out}`);
