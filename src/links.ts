import type { Config } from "./config.js";
import type { UrlGuard } from "./url-guard.js";

export type LinkVerdict = "ok" | "broken" | "review";

export interface LinkStatus {
  url: string;
  verdict: LinkVerdict;
  status: number | null;
  finalUrl: string;
  reason?: string;
}

/** Statuscodes waarmee sites bots weren; die worden "na te kijken" in plaats van "kapot". */
const BOT_BLOCK = new Set([401, 403, 429, 999]);
/** Statuscodes waarop we HEAD opnieuw proberen met GET. */
const RETRY_WITH_GET = new Set([400, 403, 405, 406, 501]);

export async function fetchWithGuard(
  url: string,
  method: "HEAD" | "GET",
  config: Config,
  guard: UrlGuard,
): Promise<{ status: number; finalUrl: string; body?: string }> {
  let current = url;
  for (let hop = 0; hop <= config.maxRedirects; hop++) {
    const parsed = new URL(current);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`protocol ${parsed.protocol}`);
    if (await guard.resolvesToPrivate(parsed.hostname)) throw new Error("intern adres geblokkeerd");
    const res = await fetch(current, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(config.linkTimeoutMs),
      headers: { "user-agent": config.userAgent, accept: "text/html,*/*;q=0.8" },
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      current = new URL(location, current).toString();
      continue;
    }
    const body = method === "GET" ? await res.text().catch(() => undefined) : undefined;
    if (method === "HEAD") await res.body?.cancel();
    return { status: res.status, finalUrl: current, body };
  }
  throw new Error(`meer dan ${config.maxRedirects} redirects`);
}

function describeError(error: unknown): string {
  const err = error as { name?: string; message?: string; cause?: { code?: string } };
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "time-out";
  const code = err?.cause?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "domein bestaat niet";
  if (code === "ECONNREFUSED") return "verbinding geweigerd";
  if ((code && code.startsWith("ERR_TLS")) || code === "CERT_HAS_EXPIRED" || code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
    return "certificaatfout";
  }
  return err?.message ?? String(error);
}

export async function checkLink(url: string, config: Config, guard: UrlGuard): Promise<LinkStatus> {
  try {
    let result = await fetchWithGuard(url, "HEAD", config, guard);
    if (RETRY_WITH_GET.has(result.status)) result = await fetchWithGuard(url, "GET", config, guard);
    const { status, finalUrl } = result;
    if (status >= 200 && status < 300) return { url, verdict: "ok", status, finalUrl };
    if (BOT_BLOCK.has(status)) return { url, verdict: "review", status, finalUrl, reason: "site weert mogelijk bots" };
    return { url, verdict: "broken", status, finalUrl, reason: `HTTP ${status}` };
  } catch (error) {
    const reason = describeError(error);
    if (reason === "intern adres geblokkeerd") return { url, verdict: "review", status: null, finalUrl: url, reason };
    return { url, verdict: "broken", status: null, finalUrl: url, reason };
  }
}

/** Voert taken uit met een maximum aantal tegelijk. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
