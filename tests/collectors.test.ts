import { describe, expect, test } from "bun:test";
import { appleAdapter } from "../server/collectors/apple";
import { googleAdapter } from "../server/collectors/google";
import { normalizeListing, normalizeReview, parseStoreUrl, planLocales } from "../server/collectors/common";
import { collectWebsite, extractPage, isPublicAddress, robotsAllowed, validatePublicUrl, WEB_LIMITS, type WebIO, type WebResponse } from "../server/collectors/web";
import { verifiedCounterpart } from "../server/research";

const locale = { country: "US", language: "en" };
const signal = () => new AbortController().signal;
describe("real adapter normalization and store scope", () => {
  test("exact store IDs survive URL parsing; ambiguous/non-store URLs rejected", () => {
    expect(parseStoreUrl("https://apps.apple.com/de/app/calm/id571800810?x=1")).toMatchObject({ store: "apple", appId: "571800810", country: "DE" });
    expect(parseStoreUrl("https://play.google.com/store/apps/details?id=com.calm.android&hl=de")).toMatchObject({ store: "google", appId: "com.calm.android" });
    for (const url of ["http://apps.apple.com/app/id123", "https://apps.apple.com.evil.test/app/id123", "https://u:p@apps.apple.com/app/id123", "https://play.google.com/store/apps/details?id=a.b&id=c.d", "file:///etc/passwd", "https://apps.apple.com/app/title", "https://play.google.com/store/apps/details?id=../../x"]) expect(() => parseStoreUrl(url)).toThrow();
  });
  test("rating totals remain separate from written reviews and raw provenance is retained", () => {
    expect(normalizeListing("apple", { id: 123, reviews: 1000, title: "Sleep" }, locale, { country: "us" })).toMatchObject({ appId: "123", ratingTotal: 1000, writtenReviewTotal: null, request: { country: "us" } });
    expect(normalizeListing("google", { appId: "com.sleep.app", ratings: 1000, reviews: 17 }, locale, {})).toMatchObject({ ratingTotal: 1000, writtenReviewTotal: 17 });
    const review = normalizeReview("google", "com.sleep.app", { id: "r1", text: "Sehr gut", score: 5, date: "2026-09-01" }, { country: "DE", language: "de" }, { lang: "de" });
    expect(review).toMatchObject({ reviewId: "r1", text: "Sehr gut", country: "DE", language: "de", detectedLanguage: null, directReviewUrl: false, identityVerified: false });
    expect(review.rawFingerprint).toHaveLength(64);
    expect(normalizeReview("apple", "123", { score: 1, text: "no id" }, locale, {}, true).identityVerified).toBe(false);
  });
  test("Apple streams are storefronts, Google uses one country anchor per language", () => {
    expect(planLocales("apple", ["US", "GB", "DE", "US"])).toHaveLength(3);
    expect(planLocales("google", ["US", "GB", "DE", "AT", "FR"], ["ja"])).toEqual([{ country: "US", language: "en" }, { country: "DE", language: "de" }, { country: "FR", language: "fr" }, { country: "US", language: "ja" }]);
  });
  test("installed wrappers issue bounded exact options and Apple page numbers are not response cursors", async () => {
    const calls: unknown[] = [];
    const api = { category: { HEALTH: 6013 }, collection: { TOP_FREE_IOS: "topfreeapplications" }, sort: { RECENT: "mostrecent" }, search: async (options: unknown) => { calls.push(options); return Array.from({ length: 15 }, (_, i) => i + 1); }, app: async () => ({ id: 1 }), list: async () => [], similar: async () => [], reviews: async (options: unknown) => { calls.push(options); return [{ id: "x", score: 2, text: "Review" }]; } };
    const apple = appleAdapter(api);
    expect(await apple.search("sleep", locale, signal())).toHaveLength(10);
    expect(calls[0]).toMatchObject({ idsOnly: true, num: 10, country: "us" });
    expect(await apple.reviews("1", locale, null, signal())).toMatchObject({ nextCursor: "2", exhausted: false, reviews: [{ reviewId: "x", identityVerified: true, identityReason: "validated_scope" }] });
    await expect(apple.reviews("1", locale, "11", signal())).rejects.toThrow();
    const google = googleAdapter({ ...api, category: { HEALTH: "HEALTH" }, collection: { TOP_FREE: "TOP_FREE" }, sort: { NEWEST: 2 }, reviews: async options => { calls.push(options); return { data: [{ id: "x", score: 3, text: "Review" }], nextPaginationToken: "next" }; } });
    expect(await google.reviews("com.sleep.app", locale, "previous", signal())).toMatchObject({ nextCursor: "next", exhausted: false, reviews: [{ reviewId: "x", identityVerified: true, identityReason: "validated_scope" }] });
    expect(calls.at(-1)).toMatchObject({ paginate: true, nextPaginationToken: "previous", num: 100, sort: 2 });
  });
});

const html = `<html><body><main><h1>Sleep journal</h1><p>${"A useful description of sleep tracking and offline features. ".repeat(4)}</p><a href="/pricing">Plans</a></main></body></html>`;
function network(responses: Record<string, Partial<WebResponse>>, dns = ["93.184.216.34"]) {
  const requests: string[] = [];
  const io: WebIO = { resolve: async () => dns, request: async (url, addresses) => { expect(addresses).toEqual(dns); requests.push(url.href); const response = responses[url.pathname] ?? { status: 404 }; return { status: 200, headers: { "content-type": "text/html" }, body: html, ...response }; } };
  return { io, requests };
}
describe("bounded website security without external requests", () => {
  test("blocks local/private/link-local/multicast/reserved IPv4 and IPv6, including mapped forms", async () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.2", "192.168.1.2", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "ff02::1", "::ffff:127.0.0.1", "2001:db8::1"]) expect(isPublicAddress(address)).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true); expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    for (const url of ["file:///etc/passwd", "http://localhost", "http://127.1", "http://2130706433", "http://[::1]", "http://u:p@example.test", "http://example.test:8080"]) await expect(validatePublicUrl(url, async () => ["8.8.8.8"])).rejects.toThrow();
    await expect(validatePublicUrl("https://example.test", async () => ["8.8.8.8", "10.0.0.1"])).rejects.toThrow();
  });
  test("DNS is validated on redirects and transport receives only validated pinned addresses", async () => {
    let resolutions = 0; const net = network({ "/robots.txt": { status: 404 }, "/": { status: 302, headers: { location: "/redirect" } } });
    net.io.resolve = async () => ++resolutions >= 4 ? ["127.0.0.1"] : ["93.184.216.34"];
    const result = await collectWebsite("https://example.test", signal(), net.io);
    expect(result.failures[0].reason).toBe("blocked_destination"); expect(net.requests).not.toContain("https://example.test/redirect");
    const cross = network({ "/robots.txt": { status: 404 }, "/": { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } } });
    expect((await collectWebsite("https://example.test", signal(), cross.io)).pages).toHaveLength(0);
  });
  test("DNS resolution cannot outlive cancellation", async () => {
    const controller = new AbortController(); const pending = validatePublicUrl("https://example.test", async () => new Promise(() => {}), controller.signal); controller.abort();
    await expect(pending).rejects.toThrow();
  });
  test("robots disallow and redirect rules are enforced before requesting forbidden paths", async () => {
    expect(robotsAllowed("User-agent: *\nDisallow: /private\nAllow: /private/help", "/private")).toBe(false);
    expect(robotsAllowed("User-agent: *\nDisallow: /private\nAllow: /private/help", "/private/help")).toBe(true);
    const net = network({ "/robots.txt": { body: "User-agent: *\nDisallow: /secret" }, "/": { status: 302, headers: { location: "/secret" } } });
    expect((await collectWebsite("https://example.test", signal(), net.io)).failures[0].reason).toBe("robots_disallowed_redirect");
    expect(net.requests).not.toContain("https://example.test/secret");
  });
  test("oversized, script-only and denied pages remain Not verified; access denial stops requests", async () => {
    for (const [response, reason] of [[{ body: "x".repeat(WEB_LIMITS.bytes + 1) }, "response_too_large"], [{ body: "<body><script>document.write('app')</script></body>" }, "script_only_or_no_readable_text"], [{ status: 403 }, "http_403"], [{ status: 429 }, "http_429"]] as const) {
      const net = network({ "/robots.txt": { status: 404 }, "/": response }); const result = await collectWebsite("https://example.test", signal(), net.io);
      expect(result.pages).toHaveLength(0); expect(result.failures[0]).toMatchObject({ status: "Not verified", reason });
    }
    const deniedRobots = network({ "/robots.txt": { status: 429 } });
    expect((await collectWebsite("https://example.test", signal(), deniedRobots.io)).failures[0].reason).toBe("robots_http_429"); expect(deniedRobots.requests).toHaveLength(1);
  });
  test("five-page cap, readable text and exact external store links", async () => {
    const links = Array.from({ length: 9 }, (_, i) => `<a href="/features/${i}">Feature</a>`).join("");
    const net = network({ "/robots.txt": { status: 404 }, "/": { body: html + links } });
    const result = await collectWebsite("https://example.test", signal(), net.io); expect(net.requests.length).toBeLessThanOrEqual(6); expect(result.failures.some(f => f.reason === "five_page_limit")).toBe(true);
    const page = extractPage(`${html}<a href="https://apps.apple.com/app/id123">iOS</a><a href="https://play.google.com/store/apps/details?id=com.sleep.app">Android</a>`, new URL("https://example.test"));
    const listing = normalizeListing("apple", { id: 123, title: "Sleep journal" }, locale, {});
    expect(verifiedCounterpart(listing, [page], ["google:com.sleep.app"])).toEqual({ url: "https://example.test/", destinationId: "google:com.sleep.app" });
    expect(verifiedCounterpart(listing, [{ ...page, storeLinks: ["https://play.google.com/store/apps/details?id=com.sleep.app"] }], ["google:com.sleep.app"])).toBeNull();
    expect(verifiedCounterpart(listing, [page], ["google:com.different.app"])).toBeNull();
  });
});
