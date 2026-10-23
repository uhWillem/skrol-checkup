import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** True als de hostnaam overeenkomt met een patroon zoals "*.webflow.io" of "klant.be". */
export function matchesDomain(hostname: string, patterns: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return patterns.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p.startsWith("*.")) {
      const base = p.slice(2);
      return host === base || host.endsWith(`.${base}`);
    }
    // "klant.be" laat ook "www.klant.be" toe.
    return host === p || host === `www.${p}`;
  });
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const PRIVATE_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/** True voor loopback, privé-, link-local- en andere niet-publieke adressen. */
export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const n = ipv4ToInt(ip);
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (version === 6) {
    const v6 = ip.toLowerCase();
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return (
      v6 === "::" ||
      v6 === "::1" ||
      v6.startsWith("fc") ||
      v6.startsWith("fd") ||
      v6.startsWith("fe8") ||
      v6.startsWith("fe9") ||
      v6.startsWith("fea") ||
      v6.startsWith("feb") ||
      v6.startsWith("ff")
    );
  }
  return false;
}

export class UrlGuard {
  private cache = new Map<string, Promise<boolean>>();

  constructor(
    private allowedDomains: string[],
    private allowPrivateNetworks: boolean,
  ) {}

  /** Mag de crawler deze URL openen als pagina? */
  isAllowedPage(url: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return matchesDomain(parsed.hostname, this.allowedDomains);
  }

  /** True als de host naar een intern adres wijst. DNS-fouten tellen niet als intern. */
  async resolvesToPrivate(hostname: string): Promise<boolean> {
    if (this.allowPrivateNetworks) return false;
    const host = hostname.replace(/^\[|\]$/g, "");
    if (isIP(host)) return isPrivateIp(host);
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return true;
    let pending = this.cache.get(host);
    if (!pending) {
      pending = lookup(host, { all: true })
        .then((addresses) => addresses.some((a) => isPrivateIp(a.address)))
        .catch(() => false);
      this.cache.set(host, pending);
    }
    return pending;
  }
}
