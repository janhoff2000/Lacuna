import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { load } from "cheerio";
import { hash } from "./common";

export const WEB_LIMITS = { pages: 5, bytes: 1_048_576, textCharacters: 120_000, timeoutMs: 10_000, redirects: 3 } as const;
export interface WebPage { url: string; text: string; textTruncated?: boolean; links: string[]; storeLinks?: string[]; capturedAt: number; contentHash: string }
export interface WebResult { pages: WebPage[]; failures: { url: string; status: "Not verified"; reason: string }[] }
export interface WebResponse { status: number; headers: Record<string, string>; body: string }
export interface WebIO {
  resolve(host: string): Promise<string[]>;
  // Production transport connects to one already-validated address, preventing DNS rebinding.
  request(url: URL, addresses: string[], signal: AbortSignal): Promise<WebResponse>;
}
export function isPublicAddress(address: string): boolean {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress()) ip = (ip as ipaddr.IPv6).toIPv4Address();
    return ip.range() === "unicast";
  } catch { return false; }
}
export async function validatePublicUrl(value: string, resolve: WebIO["resolve"], signal: AbortSignal = AbortSignal.timeout(WEB_LIMITS.timeoutMs)): Promise<{ url: URL; addresses: string[] }> {
  const url = new URL(value); const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port)) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || !host) throw new Error("blocked_destination");
  signal.throwIfAborted();
  const addresses = isIP(host) ? [host] : await new Promise<string[]>((done, reject) => {
    const abort = () => reject(new Error("dns_timeout_or_abort")); signal.addEventListener("abort", abort, { once: true });
    resolve(host).then(done, reject).finally(() => signal.removeEventListener("abort", abort));
  });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(ip => !isPublicAddress(ip))) throw new Error("blocked_destination");
  url.hash = ""; return { url, addresses };
}
const io: WebIO = {
  resolve: async host => (await lookup(host, { all: true, verbatim: true })).map(answer => answer.address),
  request: (url, addresses, signal) => new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      agent: false, signal, headers: { "user-agent": "LacunaResearch/1.0", accept: "text/html,text/plain;q=0.8", "accept-encoding": "identity" },
      lookup: (_hostname, options, callback) => {
        const address = addresses[0];
        if (options.all) callback(null, [{ address, family: isIP(address) }]);
        else callback(null, address, isIP(address));
      },
    }, response => {
      const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value ?? ""]));
      if (Number(headers["content-length"]) > WEB_LIMITS.bytes) { response.destroy(); reject(new Error("response_too_large")); return; }
      let bytes = 0; const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > WEB_LIMITS.bytes) { response.destroy(); reject(new Error("response_too_large")); } else chunks.push(chunk); });
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject); request.end();
  }),
};
const sameSite = (a: URL, b: URL) => a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");
async function fetchPublic(value: string, origin: URL, signal: AbortSignal, network: WebIO, canAccess: (url: URL) => boolean = () => true): Promise<{ response: WebResponse; url: URL }> {
  let current = value;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(WEB_LIMITS.timeoutMs)]);
  for (let redirects = 0; redirects <= WEB_LIMITS.redirects; redirects++) {
    bounded.throwIfAborted();
    const { url, addresses } = await validatePublicUrl(current, network.resolve, bounded);
    if (!sameSite(origin, url)) throw new Error("off_site_redirect");
    if (!canAccess(url)) throw new Error("robots_disallowed_redirect");
    const response = await network.request(url, addresses, bounded);
    bounded.throwIfAborted();
    if (Buffer.byteLength(response.body) > WEB_LIMITS.bytes) throw new Error("response_too_large");
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.headers.location) throw new Error("invalid_redirect");
      current = new URL(response.headers.location, url).href; continue;
    }
    return { response, url };
  }
  throw new Error("redirect_limit");
}
export function robotsAllowed(robots: string, pathname: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let group = { agents: [] as string[], rules: [] as { allow: boolean; path: string }[] };
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim(); const index = line.indexOf(":");
    if (index < 0) continue;
    const field = line.slice(0, index).trim().toLowerCase(); const value = line.slice(index + 1).trim();
    if (field === "user-agent") {
      if (group.rules.length) { groups.push(group); group = { agents: [], rules: [] }; }
      group.agents.push(value.toLowerCase());
    } else if (["allow", "disallow"].includes(field) && group.agents.length && value) group.rules.push({ allow: field === "allow", path: value });
  }
  groups.push(group);
  const specific = groups.filter(g => g.agents.some(a => a !== "*" && "lacunaresearch".includes(a)));
  const applicable = specific.length ? specific : groups.filter(g => g.agents.includes("*"));
  const matches = applicable.flatMap(g => g.rules).filter(rule => {
    const pattern = rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replace(/\\\$$/, "$");
    return new RegExp(`^${pattern}`).test(pathname);
  }).sort((a, b) => b.path.replaceAll("*", "").length - a.path.replaceAll("*", "").length || Number(b.allow) - Number(a.allow));
  return matches[0]?.allow ?? true;
}
export function extractPage(html: string, url: URL, capturedAt = Date.now()): WebPage {
  const $ = load(html);
  const storeLinks = $("a[href]").toArray().flatMap(element => {
    try { const link = new URL($(element).attr("href")!, url); return ["apps.apple.com", "itunes.apple.com", "play.google.com"].includes(link.hostname) ? [link.href] : []; } catch { return []; }
  });
  $("script,style,noscript,svg,template,iframe,nav,footer,header,[hidden],[aria-hidden='true']").remove();
  const links = $("a[href]").toArray().flatMap(element => {
    try { const link = new URL($(element).attr("href")!, url); link.hash = ""; return sameSite(url, link) && ["http:", "https:"].includes(link.protocol) ? [link.href] : []; } catch { return []; }
  });
  $("br,p,li,h1,h2,h3,h4,section,article,div").append("\n");
  const text = ($("main").text() || $("article").text() || $("body").text()).replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
  if (text.length < 80) throw new Error("script_only_or_no_readable_text");
  const boundedText = text.slice(0, WEB_LIMITS.textCharacters);
  return { url: url.href, text: boundedText, textTruncated: boundedText.length < text.length, links: [...new Set(links)].slice(0, 100), storeLinks: [...new Set(storeLinks)].slice(0, 100), capturedAt, contentHash: hash({ text: boundedText, storeLinks }) };
}
export async function collectWebsite(value: string, signal: AbortSignal, network: WebIO = io, pages: number = WEB_LIMITS.pages): Promise<WebResult> {
  const result: WebResult = { pages: [], failures: [] };
  const failure = (url: string, reason: string) => result.failures.push({ url, reason, status: "Not verified" });
  try {
    const { url: origin } = await validatePublicUrl(value, network.resolve, AbortSignal.any([signal, AbortSignal.timeout(WEB_LIMITS.timeoutMs)]));
    const robotsUrl = new URL("/robots.txt", origin).href;
    const robots = await fetchPublic(robotsUrl, origin, signal, network);
    if ([401, 403, 429].includes(robots.response.status) || robots.response.status >= 500) { failure(value, `robots_http_${robots.response.status}`); return result; }
    if (robots.response.status !== 200 && robots.response.status !== 404 && robots.response.status !== 410) { failure(value, "robots_unavailable"); return result; }
    const rules = robots.response.status === 200 ? robots.response.body : "";
    const queue = [origin.href]; const visited = new Set<string>();
    while (queue.length && visited.size < pages) {
      signal.throwIfAborted(); const next = queue.shift()!; if (visited.has(next)) continue; visited.add(next);
      if (!robotsAllowed(rules, new URL(next).pathname)) { failure(next, "robots_disallowed"); continue; }
      try {
        const { response, url } = await fetchPublic(next, origin, signal, network, url => robotsAllowed(rules, url.pathname));
        if (!robotsAllowed(rules, url.pathname)) { failure(url.href, "robots_disallowed_redirect"); continue; }
        if (response.status !== 200) { failure(url.href, `http_${response.status}`); if ([401, 403, 429].includes(response.status)) break; continue; }
        if (!/text\/html|application\/xhtml\+xml/i.test(response.headers["content-type"] ?? "")) { failure(url.href, "not_html"); continue; }
        const page = extractPage(response.body, url); result.pages.push(page);
        if (page.textTruncated) failure(url.href, "readable_text_limit");
        const relevant = page.links.filter(link => /features?|pricing|plans|help|faq|support|product/i.test(new URL(link).pathname));
        queue.push(...relevant.filter(link => !visited.has(link) && !queue.includes(link)));
      } catch (error) { signal.throwIfAborted(); failure(next, safeWebError(error)); }
    }
    // A deliberately narrower fetch is not a coverage gap.
    if (pages >= WEB_LIMITS.pages && queue.some(link => !visited.has(link))) failure(value, "five_page_limit");
  } catch (error) { signal.throwIfAborted(); failure(value, safeWebError(error)); }
  return result;
}
function safeWebError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^(blocked_destination|off_site_redirect|response_too_large|invalid_redirect|redirect_limit|script_only_or_no_readable_text|robots_disallowed_redirect)$/.test(message) ? message : "fetch_or_dns_failed";
}
