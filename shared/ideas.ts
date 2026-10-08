// Browser-safe contract for pasted deep-research results. Lacuna never runs the
// research itself: it writes the prompt, and reads back one JSON block. Every
// pasted field except a URL is an unverified claim until a fetched page supports it.
export const IDEAS_FORMAT = "lacuna-ideas-v1";
export const MARKET_FORMAT = "lacuna-market-v1";
export const IDEA_LIMITS = { ideas: 20, urls: 3, equivalents: 4, name: 120, text: 400, url: 500, paste: 100_000 } as const;
export const COUNTRY_NAMES: Record<string, string> = {
  US: "United States", GB: "United Kingdom", DE: "Germany", FR: "France", NL: "Netherlands", ES: "Spain",
  CA: "Canada", AU: "Australia", IT: "Italy", JP: "Japan", BR: "Brazil", IN: "India",
};
export const countryName = (code: string): string => COUNTRY_NAMES[code] ?? code;
// For running prose in the generated prompts: "in the United States", "in Germany".
const inProse = (code: string): string => `${["US", "GB", "NL"].includes(code) ? "the " : ""}${countryName(code)}`;
export const PRESENCE = ["operates", "announced", "not_found", "unknown"] as const;
export type Presence = (typeof PRESENCE)[number];
export interface PastedIdea { id: string; name: string; summary: string; officialUrl: string | null; urls: string[] }
export interface PastedEquivalent { name: string; url: string | null; note: string }
export interface PastedMarket { id: string; presence: Presence; note: string; equivalents: PastedEquivalent[]; urls: string[] }

const text = (value: unknown, max: number): string => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
// Deep-research tools append tracking parameters; they are not part of the source.
export function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > IDEA_LIMITS.url) return null;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|ref_|source$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    return url.href.length <= IDEA_LIMITS.url ? url.href : null;
  } catch { return null; }
}
const urls = (value: unknown, exclude: string | null = null): string[] =>
  [...new Set((Array.isArray(value) ? value : []).map(cleanUrl).filter((url): url is string => !!url && url !== exclude))].slice(0, IDEA_LIMITS.urls);
// The answer is the last fenced json block. The block sits at the end of a long
// answer, so only the tail is read. Copying a rendered answer often drops the
// fences, so the object around the last expected key is tried as well.
function rows(full: string, key: string): unknown[] | null {
  const pasted = full.slice(-IDEA_LIMITS.paste);
  const fences = [...pasted.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(match => match[1]);
  const keyAt = pasted.lastIndexOf(`"${key}"`); const open = keyAt < 0 ? -1 : pasted.lastIndexOf("{", keyAt);
  const unfenced = open < 0 ? [] : [pasted.slice(open, pasted.lastIndexOf("}") + 1)];
  for (const candidate of [...fences.reverse(), pasted, ...unfenced]) {
    try {
      const value: unknown = JSON.parse(candidate.trim());
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>)[key])) return (value as Record<string, unknown[]>)[key];
    } catch { /* try the next candidate */ }
  }
  return null;
}
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function parseIdeas(pasted: string): { ideas: PastedIdea[]; errors: string[] } {
  const found = rows(pasted, "ideas");
  if (!found) return { ideas: [], errors: ["No JSON block was found. Paste the answer including its final json block, or only that block."] };
  const ideas: PastedIdea[] = []; const errors: string[] = [];
  for (const [index, item] of found.entries()) {
    const row = record(item); const name = text(row?.name, IDEA_LIMITS.name);
    const officialUrl = cleanUrl(row?.official_url); const sources = urls(row?.source_urls, officialUrl);
    if (!name) { errors.push(`Entry ${index + 1} has no name and was skipped.`); continue; }
    if (!officialUrl && !sources.length) { errors.push(`“${name}” has no usable source URL and was skipped.`); continue; }
    if (ideas.some(idea => idea.name.toLowerCase() === name.toLowerCase())) continue;
    if (ideas.length >= IDEA_LIMITS.ideas) { errors.push(`Only the first ${IDEA_LIMITS.ideas} ideas are used.`); break; }
    // IDs follow accepted order, so the browser and the server assign the same ones.
    ideas.push({ id: `idea-${ideas.length + 1}`, name, summary: text(row?.summary, IDEA_LIMITS.text), officialUrl, urls: sources });
  }
  if (!ideas.length && !errors.length) errors.push("The JSON block contains no ideas.");
  return { ideas, errors };
}

export function parseMarket(pasted: string, ideas: readonly PastedIdea[]): { findings: PastedMarket[]; errors: string[] } {
  const found = rows(pasted, "findings");
  if (!found) return { findings: [], errors: ["No JSON block was found. Paste the answer including its final json block, or only that block."] };
  const findings: PastedMarket[] = []; const errors: string[] = [];
  for (const [index, item] of found.entries()) {
    const row = record(item); const id = text(row?.id, 40);
    if (!ideas.some(idea => idea.id === id)) { errors.push(`Entry ${index + 1} does not match one of the listed ideas and was skipped.`); continue; }
    if (findings.some(finding => finding.id === id)) continue;
    const equivalents = (Array.isArray(row?.equivalents) ? row.equivalents : []).flatMap(value => {
      const equivalent = record(value); const name = text(equivalent?.name, IDEA_LIMITS.name);
      return name ? [{ name, url: cleanUrl(equivalent?.url), note: text(equivalent?.note, IDEA_LIMITS.text) }] : [];
    }).slice(0, IDEA_LIMITS.equivalents);
    const presence = PRESENCE.find(value => value === row?.presence) ?? "unknown";
    findings.push({ id, presence, note: text(row?.note, IDEA_LIMITS.text), equivalents, urls: urls(row?.source_urls) });
  }
  if (!findings.length && !errors.length) errors.push("The JSON block contains no findings.");
  return { findings, errors };
}

export function ideasPrompt(options: { sourceCountry: string; targetCountry: string; focus: string }): string {
  const source = inProse(options.sourceCountry); const target = inProse(options.targetCountry);
  const focus = options.focus.replace(/\s+/g, " ").trim().slice(0, 500);
  return `Research businesses, products and business models that launched or clearly gained traction in ${source} during roughly the last three years and that, as far as you can find, are not yet offered in ${target}.
${focus ? `Focus: ${focus}\n` : ""}
Include any kind of business, not only apps: services, marketplaces, retail and franchise concepts, software, consumer products. Prefer ideas with a concrete, citable sign of traction (funding, revenue, customers, locations, press coverage) whose customer need plausibly exists in ${target} too.
Exclude: businesses that already operate in ${target}; household names; ideas that only work because of an institution, law or infrastructure specific to ${source}.

For every idea give the company's own website and up to two independent sources (news, funding announcements, interviews) that describe what it does. Use direct page URLs that can be opened without logging in. Do not invent URLs.

Write whatever explanation you like, then END your answer with exactly one fenced json block in this format, with at most ${IDEA_LIMITS.ideas} ideas and no other json block after it:

\`\`\`json
{
  "format": "${IDEAS_FORMAT}",
  "ideas": [
    {
      "name": "Company or concept name",
      "summary": "One or two sentences, under 300 characters: what it is and who pays.",
      "official_url": "https://company.example/",
      "source_urls": ["https://news.example/article", "https://other.example/coverage"]
    }
  ]
}
\`\`\``;
}

export function marketPrompt(options: { sourceCountry: string; targetCountry: string; ideas: readonly PastedIdea[] }): string {
  const source = inProse(options.sourceCountry); const target = inProse(options.targetCountry);
  const list = options.ideas.map(idea => `- ${idea.id}: ${idea.name}${idea.officialUrl ? ` (${idea.officialUrl})` : ""}${idea.summary ? ` — ${idea.summary}` : ""}`).join("\n");
  return `Each business below exists in ${source}. For each one, research the market in ${target}, searching in the local language as well as English:

1. Does this exact company operate in ${target}, or has it announced that it will?
2. Which businesses in ${target} already serve the same customer need in a comparable way? Name up to ${IDEA_LIMITS.equivalents}, strongest first, each with its own website.

${list}

Be strict: a business in a neighbouring category is not an equivalent. If you find none, say so with an empty list rather than stretching. Do not invent URLs.

Write whatever explanation you like, then END your answer with exactly one fenced json block in this format, one entry per id above, and no other json block after it:

\`\`\`json
{
  "format": "${MARKET_FORMAT}",
  "findings": [
    {
      "id": "idea-1",
      "presence": "operates | announced | not_found | unknown",
      "note": "One sentence on what you found, under 300 characters.",
      "equivalents": [
        { "name": "Local company", "url": "https://local.example/", "note": "How it compares, under 300 characters." }
      ],
      "source_urls": ["https://source.example/page"]
    }
  ]
}
\`\`\``;
}
