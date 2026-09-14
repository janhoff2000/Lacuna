# Scraper validation trial

This repository uses a small, no-AI validation run before the production
collectors are designed. It checks the installed store libraries' search,
listing-details, review, pagination, review-ID, date, locale, and overlap
behaviour. It never imports or calls OpenAI.

## Installed versions

The Bun lockfile currently resolves:

- `app-store-scraper` 0.18.0
- `google-play-scraper` 10.1.3

`bun.lock` is the authoritative record for the complete dependency graph.

## Run it

```sh
bun run trial
```

The trial is bounded to a maximum of 32 requests: one search per store, details
for no more than three apps per store, and at most two review pages for each of
two locale streams per selected app. It uses US and German storefront/language
streams and includes a known popular Calm listing plus up to two search results
per store. Results are not representative of either store.

Each run creates `data/trials/<timestamp>/raw.json` with the raw scraper
responses and `summary.json` with IDs, date coverage, pagination outcomes,
cross-locale overlap, incremental locale yield, and errors. `data/trials/` is
ignored because raw reviews may contain personal data and should not be committed.

## Current result status

A live run completed at `2026-09-12T17:22:10.579Z` after the initially sandboxed
attempt was blocked from the stores. The allowed run made all 32 bounded
requests with no request errors, selected three apps per store, and returned
840 identifiable reviews. All returned records had parseable dates; their range
was `2024-06-26T13:22:16.594Z` through `2026-09-11T15:41:53.740Z`.

Apple returned 50 reviews for every one of its 12 sampled pages, but its
responses expose no continuation token or cursor. Page 2 was requested because
the trial is configured to make up to two page-number requests per stream; it
was not observed as available from a page 1 response. Google returned the
requested 20 reviews for every one of its 12 sampled pages and supplied a
next-page token on every page. The sampled locale streams produced 300 unique
Apple reviews for US, 300 for Germany, 120 unique Google reviews for US/English,
and 120 for Germany/German; this run observed no duplicate IDs across those
streams. The installed Apple scraper rejects pages above 10, but this trial only
uses pages 1 and 2.

These are point-in-time observations, not production guarantees. Do not use the
zero-overlap observation to claim that locales never overlap, and do not trust
review IDs for later schema decisions until repeated sessions, sorting modes,
and content-change checks have been compared. The raw evidence stays local under
the ignored trial directory.
