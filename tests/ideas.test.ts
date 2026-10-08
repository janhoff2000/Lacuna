import { describe, expect, test } from "bun:test";
import { IDEA_LIMITS, cleanUrl, ideasPrompt, marketPrompt, parseIdeas, parseMarket } from "../shared/ideas";

const answer = (value: unknown) => `Here is what I found.\n\n\`\`\`json\n{"draft": true}\n\`\`\`\n\nFinal list:\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\nHope that helps!`;
describe("pasted deep-research contract", () => {
  test("ideas come from the last json block and rows without a usable source are skipped", () => {
    const { ideas, errors } = parseIdeas(answer({ format: "lacuna-ideas-v1", ideas: [
      { name: "  Pantry  Club ", summary: "Refill groceries by subscription.", official_url: "https://pantry.example/?utm_source=chatgpt.com#top", source_urls: ["https://news.example/a?ref=x&id=7", "javascript:alert(1)", "https://pantry.example/"] },
      { name: "No Sources", summary: "x", official_url: "ftp://files.example", source_urls: [] },
      { summary: "nameless", official_url: "https://nameless.example" },
      { name: "pantry club", official_url: "https://duplicate.example" },
      { name: "Coverage Only", source_urls: ["https://user:pw@secret.example/x", "https://press.example/story"] },
    ] }));
    expect(ideas).toEqual([
      { id: "idea-1", name: "Pantry Club", summary: "Refill groceries by subscription.", officialUrl: "https://pantry.example/", urls: ["https://news.example/a?id=7"] },
      { id: "idea-2", name: "Coverage Only", summary: "", officialUrl: null, urls: ["https://press.example/story"] },
    ]);
    expect(errors).toHaveLength(2);
    expect(parseIdeas("no json here").ideas).toEqual([]);
    expect(parseIdeas(JSON.stringify([{ name: "Bare", official_url: "https://bare.example" }])).ideas).toHaveLength(1);
    expect(cleanUrl("https://x.example/" + "a".repeat(600))).toBeNull();
  });

  test("the json block is found at the end of a very long answer and without its fences", () => {
    const block = JSON.stringify({ format: "lacuna-ideas-v1", ideas: [{ name: "Pantry Club", official_url: "https://pantry.example" }] });
    expect(parseIdeas(`${"Long report. ".repeat(20_000)}\n\`\`\`json\n${block}\n\`\`\``).ideas).toHaveLength(1);
    expect(parseIdeas(`Summary with {braces} in prose.\n\njson\n${block}\n\nLet me know if you want more.`).ideas).toHaveLength(1);
    const findings = JSON.stringify({ findings: [{ id: "idea-1", presence: "not_found", equivalents: [] }] });
    expect(parseMarket(`Report text\n${findings}\nDone.`, parseIdeas(block).ideas).findings).toHaveLength(1);
  });

  test("the idea list is capped and a maximum-size answer stays within the paste limit", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ name: `Idea ${index}`, summary: "s".repeat(600), official_url: `https://idea${index}.example/${"p".repeat(300)}`, source_urls: [`https://a${index}.example/${"q".repeat(300)}`, `https://b${index}.example/${"q".repeat(300)}`] }));
    const pasted = answer({ ideas: many });
    const { ideas, errors } = parseIdeas(pasted);
    expect(ideas).toHaveLength(IDEA_LIMITS.ideas);
    expect(ideas[0].summary).toHaveLength(IDEA_LIMITS.text);
    expect(errors.some(error => error.includes("first 20"))).toBe(true);
    expect(pasted.length).toBeLessThan(IDEA_LIMITS.paste);
  });

  test("target-market findings must refer to ids Lacuna issued", () => {
    const { ideas } = parseIdeas(answer({ ideas: [{ name: "Pantry Club", official_url: "https://pantry.example" }] }));
    const { findings, errors } = parseMarket(answer({ findings: [
      { id: "idea-1", presence: "definitely", note: "Nothing found.", equivalents: [{ name: "Vorratsklub", url: "https://vorrat.example", note: "Same model." }, { url: "https://nameless.example" }], source_urls: ["https://de.example/x"] },
      { id: "idea-9", presence: "operates" },
    ] }), ideas);
    expect(findings).toEqual([{ id: "idea-1", presence: "unknown", note: "Nothing found.", equivalents: [{ name: "Vorratsklub", url: "https://vorrat.example/", note: "Same model." }], urls: ["https://de.example/x"] }]);
    expect(errors).toHaveLength(1);
  });

  test("prompts name the markets, the focus and the ids to answer for", () => {
    const first = ideasPrompt({ sourceCountry: "US", targetCountry: "DE", focus: " services for\nrestaurants " });
    expect(first).toContain("United States"); expect(first).toContain("Germany");
    expect(first).toContain("Focus: services for restaurants"); expect(first).toContain("lacuna-ideas-v1");
    const second = marketPrompt({ sourceCountry: "US", targetCountry: "DE", ideas: [{ id: "idea-1", name: "Pantry Club", summary: "Refills.", officialUrl: "https://pantry.example/", urls: [] }] });
    expect(second).toContain("- idea-1: Pantry Club (https://pantry.example/) — Refills.");
    expect(second).toContain("lacuna-market-v1");
  });
});
