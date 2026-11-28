# K1c: the real shape of every feed, and each host's limits and credit line (P2, on Kobol)

Checked on 2026-11-28, from about 12:46 to 13:30 Taipei (04:46 to 05:30 UTC), on Kobol. I used plain
Node `fetch`, GET only, with the `user_agent` of `config/run.json`, and paced each host separately:

- arXiv: one request at a time, 3 seconds apart.
- NCBI: at most 3 a second.
- Crossref and every other host: about 1 a second.

I used no login, no key and no workaround of any block, and I did not call OpenAlex. In all I made 269
requests. The bodies stay outside the repo, in `~/.unveiling/p2-scratch/k1c/captures/`.
`K1c-feeds.json` holds everything below in machine-readable form. Each feed's sketch there is
invented prose with the structure and field formats exactly as served, and every title, abstract, name
and link is replaced by `[text]`, `[name]` or a sample address.

## What needs a decision

1. **EurekAlert! has no RSS feed any more.** `https://www.eurekalert.org/rss.xml` is 404, and so are
   `/rss.php` and `/rss/<topic>.xml`. Its help page now calls `/news-releases/browse` its "latest news
   release feed". That page is plain HTML with `article.post` items, 12 a page, dated "27-Nov-2026". So
   `eurekalert` becomes `kind: page`, `parser: html`, read through the browse pages or the
   `?view=summaries&date=MM/DD/YYYY` view. At about 150 releases a weekday, budget 2 (24 items) reads a
   small part of the day.
2. **The arXiv window is off by its end minute.** `submittedDate:[A TO B]` reads UTC from the first
   second of minute A to just before B:00, so the end minute is not included:
   - a paper submitted at 18:59:26 is in `[1859 TO 1900]`;
   - it is in neither `[1859 TO 1859]` nor `[1858 TO 1859]`;
   - `[1858 TO 1859]` gave the eight papers of 18:58.

   SPEC 4.13's "to one minute before its deadline" therefore drops every paper of the last minute. The
   query must end at the deadline minute itself (14:00 ET, written as HHMM in UTC). arXiv's own holiday
   notice uses the same reading: "at or after 14:00 ET ... and before 14:00 ET".
3. **The arXiv categories need their aliases.** `cat:math*` misses papers whose category arXiv reports
   by its alias:
   - `cs.IT` (math.IT): 16 new and cross-listed papers in one announcement;
   - `math-ph` (math.MP).

   So `arxiv-math` should query `(cat:math* OR cat:cs.IT OR cat:math-ph)`. With both fixes, the API list
   for the announcement of Wednesday 2026-11-25 20:00 ET held 409 papers. Every one is on
   `https://arxiv.org/list/math/new`, which holds 440: 379 new submissions and 61 cross-lists. The 31 on
   the page that the API lacked were all submitted before the window, so they are papers arXiv held and
   announced late, which the spec allows. My first query, as the spec writes it, found 391 and missed
   18 papers inside the window. `arxiv-physics` (`cat:physics*`) covers only the physics.* archive, not
   hep, gr-qc, nucl or math-ph. That is narrower than its name, and the cloud session can decide whether
   it is meant.
4. **The Retraction Watch file is 68.4 MB.** That is far over `fetchFeed()`'s 5 MB body cap, so it
   needs a cap of its own. It also holds a row dated 2027-08-27, in the future. A freshness check by
   newest date would never go stale, so it should ignore future dates or use the file's commit date.
5. **Blocked: pubs.acs.org (JACS and Environmental Science & Technology).** Every plain GET answers 403
   with `cf-mitigated: challenge`, a Cloudflare browser check. I tried no workaround. These two journals
   come only through `crossref-journals`.
6. **No feed found for Acta Mathematica or the Journal of Biblical Literature.** For Acta,
   `intlpress.com/acta` has no feed link, and Project Euclid served a 1 KB page with no content.
   Springer journal-id 11511 is another journal, whose newest item is from 2016. The SBL site lists JBL
   issues as news posts only. Both come only through Crossref.
7. **Moved:**
   - **mathlib's statistics.** The old URL is now a 1 KB "Page Moved" page that redirects by script and
     meta refresh, not by HTTP, to `https://mathlib.org/mathlib_stats.html`.
   - **Microsoft Research AI for Science.** The lab's own feed has had no item since 2025-06-18. The
     live feed is Microsoft Research's site-wide `https://www.microsoft.com/en-us/research/feed/`, to
     read with `must_match` true.
8. **bioRxiv and medRxiv now issue DOIs with the prefix 10.64898.** 29 of 30 new bioRxiv items had it;
   older papers keep 10.1101. Any DOI rule or resolver entry keyed to 10.1101 must take both.
9. **Abstracts are often missing from the answers:**
   - PubMed's `esummary` has no abstract at all. The search matched title or abstract, but the pack
     gets no abstract text unless collect adds `efetch`, one more request.
   - Crossref's records for Nature had no abstract, 0 of 5. So `must_match` on `crossref-journals`
     reads titles alone for most leading journals.
   - Nature's feeds carry a standfirst, not the abstract.
10. **bioRxiv pages hold 30 items each.** A one-day window was 511 items over two days, which needs
    about 9 pages a day, over budget 5. medRxiv (111 over two days) fits.

## Feeds

`fresh_days` is the longest normal gap between items, rounded up, plus a day, as the brief asks;
where a feed holds too few items to show it, the publishing cadence sets it. The basis is in each row
of `K1c-feeds.json`. `date_zone` is `null` (UTC) unless the feed writes times without a zone. Every
feed with a time names its zone, so only date-only values are zoneless, and I propose `null` for them
too: each is a calendar day, and none of these publishers dates in Taipei time. Sakana AI is the one
feed I would set, to `+09:00`, though its times carry the zone anyway. "Newest" is the age at the
fetch.

**Preprint servers and indexes**

| Feed | Status | Format | Dates and zone | Items, newest, gap | `fresh_days` | `date_zone` | URL / fallback | Problems |
|---|---|---|---|---|---|---|---|---|
| arxiv-math | 200 | Atom 1.0 | `published` ISO Z (submission). An entry is dated by its announcement | 409 in one list | 5 | null | API; fallback `rss.arxiv.org/atom/math` | End minute and aliases (items 2, 3) |
| arxiv-physics | 200 | Atom | as math | 116 | 5 | null | as math | `physics*` is the physics archive only |
| arxiv-astro-ph | 200 | Atom | as math | 101 | 5 | null | as math | |
| arxiv-cond-mat | 200 | Atom | as math | 124 | 5 | null | as math | |
| arxiv-quant-ph | 200 | Atom | as math | 103 | 5 | null | as math | |
| arxiv-q-bio | 200 | Atom | as math | 24 | 5 | null | as math | |
| arxiv-physics-chem-ph | 200 | Atom | as math | 15 | 5 | null | as math | |
| arxiv-stat-ml | 200 | Atom | as math | 28 (16 cross-listed elsewhere) | 5 | null | as math | |
| biorxiv | 200 | JSON, 30 a page by cursor | `date` YYYY-MM-DD | 511 in 2 days | 3 | null | `/details/biorxiv/<from>/<to>/<cursor>` | Pages over budget; DOI prefix 10.64898 |
| medrxiv | 200 | JSON | as biorxiv | 111 in 2 days | 3 | null | as biorxiv | |
| pubmed | 200 | JSON (esearch, esummary) | `pubdate` "2026 Nov 27", `sortpubdate` "2026/11/27 00:00" | 675 in 2 days | 4 | null | as drafted, with `datetype=edat` | No abstract in esummary |
| crossref-journals | 200 | JSON | date-parts, no zone | 116 for Nature in a week | 4 | null | `works?filter=issn:<issn>,from-pub-date:<d>` | Few abstracts. News and corrections are also `journal-article` |

**Leading journals' own feeds**

| Feed | Status | Format | Dates and zone | Items, newest, gap | `fresh_days` | `date_zone` | URL / fallback | Problems |
|---|---|---|---|---|---|---|---|---|
| journal-nature | 200 | RSS 1.0 (RDF) | `dc:date` YYYY-MM-DD | 75; 1.2 days; gap 1 | 4 | null | as drafted | |
| journal-science | 200 | RSS 1.0 | `dc:date` ISO Z; `dc:type` holds the article type | 36; 1.9 days; weekly | 8 | null | as drafted | A second fetch in the same minute got 403 |
| journal-pnas | 200 | RSS 1.0 | ISO Z | 111; 3.9 days; gap 4 | 8 | null | as drafted | |
| journal-cell (new) | 200 | RSS 1.0 | YYYY-MM-DD; `prism:section` | 67; 4.2 days; gap 5 | 7 | null | `cell.com/cell/inpress.rss`; fallback `current.rss` | |
| journal-prl (new) | 200 | RSS 1.0 | ISO +00:00; `prism:section` | 100; 2.8 days; gap 3 | 4 | null | `feeds.aps.org/rss/recent/prl.xml` | |
| journal-annals-of-mathematics (new) | 200 | RSS 2.0 (WordPress) | RFC 822 +0000 | 100 back to 2024; 21 days; gap 70 | 71 | null | `annals.math.princeton.edu/feed` | No DOI in the feed |
| journal-nature-physics, -chemistry, -materials, -medicine, -biotechnology, -geoscience, -climate-change, -human-behaviour (new) | 200 | RSS 1.0 | YYYY-MM-DD | 8 each; 1.2 to 4.2 days; gaps up to 8 | 10 | null | `nature.com/<nphys, nchem, nmat, nm, nbt, ngeo, nclimate, nathumbehav>.rss` | Only the 8 newest items; Crossref is the full list |
| journal-jacs (new) | 403 | | | | | | none | Cloudflare challenge |
| journal-nejm (new) | 200 | RSS 1.0 | ISO Z | 59; 2.8 days; weekly | 8 | null | `nejm.org/action/showFeed?jc=nejm&type=etoc&feed=rss` | |
| journal-lancet (new) | 200 | RSS 1.0 | YYYY-MM-DD | 27; 0.2 days; weekly | 8 | null | `thelancet.com/rssfeed/lancet_current.xml`; fallback `lancet_online.xml` | |
| journal-aer (new) | 200 | RSS 1.0 | ISO Z | 11, one issue; 29 days | 35 | null | `pubs.aeaweb.org/action/showFeed?type=etoc&feed=rss&jc=aer` | `www.aeaweb.org/journals/aer/rss` is 404 |
| journal-apsr (new) | 200 | RSS 1.0 | YYYY-MM-DD, not in date order | 26; 31 days; gap 79 | 80 | null | `cambridge.org/core/rss/product/id/833A7242AC7B607BA7F6168DA072DB3B` | Product id read from the journal page |
| journal-inventiones (new) | 200 | RSS 2.0 | `pubDate` YYYY-MM-DD, not RFC 822 | 20; 8 days; gap 18 | 19 | null | `link.springer.com/search.rss?facet-content-type=Article&facet-journal-id=222` | Redirects with `error=cookies_not_supported`, but serves |
| journal-jams (new) | 200 | RSS 2.0 | "Thu, 24 Sep 2026 12:53 EDT" | 4, one issue; 64 days | 100 | null | `ams.org/rss/jams.rss` | Zone abbreviation |
| journal-acta-mathematica (new) | none | | | | | | none | No feed found |
| journal-es-and-t (new) | 403 | | | | | | none | Cloudflare challenge |
| journal-grl (new) | 200 | RSS 2.0 (Wiley) | RFC 822 -0800; `dc:date` ISO -08:00 | 14; 1.1 days; gap 1 | 4 | null | `agupubs.onlinelibrary.wiley.com/feed/19448007/most-recent` | |
| journal-jgr-atmospheres (new) | 200 | RSS 2.0 (Wiley) | as GRL | 11; 1.6 days | 4 | null | `.../feed/21698996/most-recent` | |
| journal-language (new) | 200 | RSS 1.0 (Project MUSE) | ISO -05:00 | 8, one issue; 1 day | 100 | null | `muse.jhu.edu/feeds/latest_articles?jid=112` | No DOI |
| journal-antiquity (new) | 200 | RSS 1.0 (Cambridge) | YYYY-MM-DD | 39; 58 days; gap 36 | 65 | null | `cambridge.org/core/rss/product/id/C06207AB2CE3EE948718B5F6E30870D7` | |
| journal-classical-quarterly (new) | 200 | RSS 1.0 (Cambridge) | YYYY-MM-DD | 57; 81 days; gap 41 | 190 | null | `cambridge.org/core/rss/product/id/98B56E98F6176CC085C2D10BEF5DA258` | |
| journal-jbl (new) | none | | | | | | none | No feed |
| journal-hts (new) | 200 | RSS 2.0 (OJS) | RFC 822 +0100 | 10; 1.8 days; gap 14 | 15 | null | `hts.org.za/index.php/hts/gateway/plugin/WebFeedGatewayPlugin/rss2` | No DOI |

**Institutions, labs and reactions**

| Feed | Status | Format | Dates and zone | Items, newest, gap | `fresh_days` | `date_zone` | URL / fallback | Problems |
|---|---|---|---|---|---|---|---|---|
| eurekalert | 404 | becomes HTML | "27-Nov-2026" | 12 a page | 4 | null | `eurekalert.org/news-releases/browse` | RSS gone (item 1) |
| lab-deepmind | 200 | RSS 2.0 | RFC 822 +0000 | 100; 3.7 days; recent gap 7, longest 21 | 22 | null | as drafted | |
| lab-openai (new) | 200 | RSS 2.0, 870 KB | RFC 822 GMT | 1,430; 3.7 days; gap 1.6 | 7 | null | `openai.com/news/rss.xml` | All news: set `must_match` true |
| lab-anthropic (new) | 200 | HTML | `<time>` "Nov 17, 2026" | 32 | 30 | null | `anthropic.com/research`; fallback `/news` | No feed; generated class names |
| lab-meta-fair (new) | 200 | HTML | text "July 9, 2026" | 5 | 45 | null | `ai.meta.com/blog/` | Client-rendered; newest post shown is July |
| lab-microsoft-ai-for-science (new) | 200 | RSS 2.0 | RFC 822 | 5; 528 days | null | null | site-wide `microsoft.com/en-us/research/feed/` | Lab feed stale |
| lab-futurehouse (new) | 200 | HTML | no dates on the list | 9 | null | null | `futurehouse.org/research` | No feed, no dates |
| lab-periodic-labs (new) | 200 | HTML | `<time datetime>` ISO Z | 4; newest 2026-09-15 | 90 | null | `periodic.com/news` | Relative links |
| lab-isomorphic-labs (new) | 200 | HTML | no dates on the list | 22 | null | null | `isomorphiclabs.com/news` | `/articles` is 404 |
| lab-lila-sciences (new) | 200 | HTML | "November 20, 2026" | 5 | 30 | null | `www.lila.ai/news` | The list also links outside press |
| lab-sakana-ai (new) | 200 | Atom 1.0 | ISO +09:00 | 10; 2.6 days; gap 9 | 30 | +09:00 | `sakana.ai/feed.xml` | |
| lab-arc-institute (new) | 200 | HTML | `<time datetime>` ISO Z | 5; 9 days | 30 | null | `arcinstitute.org/news` | No feed |
| lab-allen-institute-for-ai (new) | 200 | RSS 2.0 | `pubDate` ISO -08:00, not RFC 822 | 25; 2.9 days; gap 7 | 30 | null | `allenai.org/rss.xml` | |
| smc-reactions | 200 | RSS 2.0 at `/feed/`; HTML home | RFC 822 +0000 | 20; about daily | 7 | null | `sciencemediacentre.org/feed/`; fallback the home page | Feed mixes post kinds |

**Metrics, the rung watch and the counters**

| Feed | Status | Format | Dates and zone | Items, newest, gap | `fresh_days` | `date_zone` | URL / fallback | Problems |
|---|---|---|---|---|---|---|---|---|
| openalex | not called | | | | null | null | as drafted | See K1a |
| crossref-updates | 200 | JSON | date-parts | | null | null | `works?filter=updates:<a>,updates:<b>,...&rows=100` | One notice can name many works |
| retraction-watch | 200 | CSV, 74,173 rows, 68.4 MB | M/D/YYYY 0:00 | daily | 30 | null | as drafted | Over the 5 MB cap; a future date |
| ctgov | 200 | JSON | YYYY-MM or YYYY-MM-DD | | null | null | `studies?filter.ids=<ids>&pageSize=<n>` | |
| rcsb | 200 | JSON | | 17,052 entries deposited in 2025 | null | null | GET with `?json=<query>` | |
| mathlib-stats | 200 | HTML | | | null | null | `mathlib.org/mathlib_stats.html` | Moved |
| erdos | 200 | HTML | "08 Oct 2026" on threads | | null | null | as drafted; data in GitHub `teorth/erdosproblems` | Counter detail in K1d |
| scrollprize | 200 | RSS 2.0 (Substack), 561 KB | RFC 822 GMT | 20; 4 days; gap 78 | 80 | null | as drafted | The seed's 60 is under the longest gap |
| naer-terms | 200 | HTML | | | null | null | as drafted | Terms page 404 (K1d) |

## Selectors for the page feeds

Class names on most of these sites are generated, so the selectors key on paths and on `<time>`.

| Feed | Selector | What each item gives |
|---|---|---|
| eurekalert | `article.post` with `a[href^="/news-releases/"]` | Link and title; the date as "DD-Mon-YYYY" text; the institution; the release type ("Peer-Reviewed Publication") |
| smc-reactions (page fallback) | `article.article-list-item > header h3 a`, plus `time` | Link and title; the date as "November 26, 2026". Keep the paths `/expert-reaction-to-` and `/experts-react-` |
| lab-anthropic | `a[href^="/research/"]` (on `/news`: `article` with `a[href^="/news/"]`), with the nearest `time` | Link and title; the date as "Nov 17, 2026" |
| lab-meta-fair | `a[href*="/blog/"]` with a slug, and the card's date text | Link and title; the date as "July 9, 2026" |
| lab-futurehouse | `div.card a.u-link-cover[href^="/research/"]` | Link and title, no date |
| lab-periodic-labs | `a[href^="./news/"]` holding a `time[datetime]` | Link, title and an ISO date |
| lab-isomorphic-labs | `a.news-card[href^="/articles/"]`, `a.news-featured_title[href^="/articles/"]` | Link and title, no date |
| lab-lila-sciences | `div.news-list_item a[href^="/news/"]` and its date text | Link, title, "November 20, 2026" |
| lab-arc-institute | `article[class*="PostList_postItem"] h3 a[href^="/news/"]`, with `time[datetime]` | Link, title, ISO date |
| erdos | home page: `ul.thread-list li.thread-item a.thread-title` | Forum and blog threads with dates. The counter should read the repository data instead (K1d) |
| mathlib-stats | the counts in the page text at the new URL | K1d settles the exact selector with the counter |

## arXiv

- **`submittedDate`:** it reads UTC. The start minute is included from its first second, and the end
  minute is excluded (item 2). I tested this with `[1859 TO 1859]` (0 results), `[1859 TO 1900]` (the
  paper at 18:59:26) and `[1858 TO 1859]` (the eight papers of 18:58).
- **The window list against `/list/math/new`:** done for the announcement of Wednesday 2026-11-25
  20:00 ET, which the page heads "Thursday, 26 November 2026". The corrected query matched every
  in-window paper on the page, and nothing extra (item 3).
- **Not done: the Tuesday and Wednesday check.** Today is Saturday in Taipei. The Sunday and Monday
  announcements still need the same comparison on a Tuesday and a Wednesday morning before 08:00
  Taipei, for example in a P3 dry run.
- **`id_list` with 100 ids and `max_results=100`:** it answered for all 100.
- **The listing feed fallback:** `https://rss.arxiv.org/atom/math` answered 200 with an empty feed
  (updated 2026-11-27T05:00Z) on the US Thanksgiving Friday, as SPEC 4.13 expects when no announcement
  came.
- **`fresh_days`:** the longest normal gap from an announcement to a morning's window end at 03:15
  Taipei is 3.75 days. It comes from a Thursday's list after a skipped Friday or Thursday (Thanksgiving,
  Christmas, New Year), so `fresh_days` is 5.
- **Limits:** arXiv's API terms say "make no more than one request every three seconds, and limit
  requests to a single connection at a time", for all machines together. That matches SPEC 4.13.

**Proposed `arxiv_skipped`, for the next 12 months.** These are the US dates of the skipped
announcements. Sources: arXiv's availability page (https://info.arxiv.org/help/availability.html) and
its blog notice of 2026-11-25 (https://blog.arxiv.org/2026/11/25/holiday-announcement-schedule/).

| Skipped announcement (US date) | Why |
|---|---|
| 2026-12-27 | Christmas on Friday 2026-12-25. The blog says the list goes out Monday 2026-12-28 |
| 2027-01-03 | New Year's Day on Friday 2027-01-01. The list goes out Monday 2027-01-04 |
| 2027-01-18 | Martin Luther King Jr. Day |
| 2027-02-15 | Presidents' Day |
| 2027-05-31 | Memorial Day |
| 2027-06-20 | Juneteenth observed on Friday 2027-06-18 |
| 2027-07-05 | Independence Day observed |
| 2027-09-06 | Labor Day |
| 2027-10-11 | Columbus Day / Indigenous Peoples' Day |
| 2027-11-11 | Veterans Day |
| 2027-11-25 | Thanksgiving |

Past 2026 dates, for the tests: 2026-01-01, 2026-01-19, 2026-06-21, 2026-07-05, 2026-09-07,
2026-10-12, 2026-11-11 and 2026-11-26. 2026-06-21 and 2026-07-05 are Sundays after Friday holidays.

The blog's rule for a Friday holiday agrees with the spec's: the Sunday announcement is skipped, and
its submissions go out on the Monday. For 2026 Thanksgiving, the notice moved Thursday's list to
Sunday 2026-11-29, which is what the spec's "the next announcement takes the skipped one's
submissions" gives.

## Crossref and ClinicalTrials.gov

- **`updates:` filters are an OR.** One filter answered 1 notice, two answered 2, and 50 answered 72
  notices naming 49 distinct works. One of the 50 DOIs was a repeat, so 49 was everything asked. The
  notice types were retraction, expression_of_concern, erratum and correction, from either `publisher`
  or `retraction-watch` sources. A single notice can name hundreds of works (one EDP Sciences notice
  named 266), so use `rows=100` or more.
- **Notices that only Retraction Watch records:**
  - **A retraction:** `10.1051/e3sconf/202342009013`. `works?filter=updates:<doi>` returns the notice
    (`10.1051/e3sconf/202342000001`), and the work's own record lists it under `updated-by` with
    `source: retraction-watch`.
  - **A retraction whose notice DOI is the paper itself:** `10.1016/j.prp.2020.153272`. Both the filter
    and `updated-by` list the paper as its own notice.
  - **An expression of concern:** `10.1093/qjmed/hcac191`. The filter returns the notice
    (`10.1093/qjmed/hcag296`), and `updated-by` lists it.
  - **In my sample:** all 40 recent retractions carried both sources; 6 of 25 recent expressions of
    concern had only Retraction Watch's; and 3 of 10 retractions from earlier years had only
    Retraction Watch's.

  So SPEC 5.8's first outcome holds: the filter returns them, and nothing changes.
- **Record fields:** a retraction notice, an expression-of-concern notice and a journal article all
  carry `title`, `container-title` (the journal), `publisher` (the company, such as "Springer Science
  and Business Media LLC") and `published`, with `issued` equal to it. The notices' own `type` is
  `journal-article`; the update type is only in `update-to`. The Retraction-Watch-only EDP Sciences
  notice has `published` as a year alone (`[[2023]]`), so it would go to the agent as a proposal, as
  SPEC 5.8 says.
- **`doi:` batch:** 50 `doi:` filters (49 distinct) answered 49 records in one request, all of them.
- **Crossref's limits:** the response headers say `x-rate-limit-limit: 5`, `x-rate-limit-interval: 1s`
  and `x-concurrency-limit: 1` for the public pool. SPEC 4.13's queue (filters one a second, single
  records five a second, one at a time) fits inside that.
- **ClinicalTrials.gov:** `studies?filter.ids=<100 NCT ids>&pageSize=100` returned all 100. Without
  `pageSize` it returned 10, as the spec says.

## Hosts: limits, terms and credit lines

The credit lines are for `docs/SOURCES.md`; `K1c-feeds.json` holds all of them, with their basis.
Where a host's terms fix the wording, it is kept as given.

| Host | Limit | Terms of reuse | Credit / Credit (zh) |
|---|---|---|---|
| arXiv API and listing feeds | One request every 3 seconds, one connection, all machines together | Metadata CC0. E-prints stay with their authors | Credit: Preprint metadata from arXiv (arxiv.org), CC0 1.0; each link goes to the paper on arXiv. / Credit (zh): 預印本詮釋資料來自 arXiv（arxiv.org），採 CC0 1.0；各連結指向 arXiv 上的論文。 |
| api.biorxiv.org | None stated; 30 items a page | Each preprint carries its own licence in `license` | Credit: Preprint metadata from the bioRxiv and medRxiv API (Cold Spring Harbor Laboratory). / Credit (zh): 預印本詮釋資料來自 bioRxiv 與 medRxiv API（冷泉港實驗室）。 |
| eutils.ncbi.nlm.nih.gov | 3 a second without a key (header `x-ratelimit-limit: 3`) | NLM data; credit the NLM | Credit: Records from PubMed, courtesy of the U.S. National Library of Medicine. / Credit (zh): 書目資料來自 PubMed，由美國國家醫學圖書館提供。 |
| api.crossref.org | 5 a second, 1 at a time (headers) | Open metadata | Credit: Metadata from Crossref. / Credit (zh): 詮釋資料來自 Crossref。 |
| gitlab.com (Retraction Watch file) | Unauthenticated: `ratelimit-limit: 500` | Made openly available by Crossref; K1d checks the exact citation line | Credit: Retraction Watch Database, made openly available by Crossref. / Credit (zh): Retraction Watch 資料庫，由 Crossref 開放提供。 |
| clinicaltrials.gov | None stated on the API page read | US government data | Credit: Trial records from ClinicalTrials.gov, U.S. National Library of Medicine. / Credit (zh): 臨床試驗紀錄來自 ClinicalTrials.gov（美國國家醫學圖書館）。 |
| search.rcsb.org | None stated | CC0 1.0 ("All data provided by RCSB PDB programmatic APIs are available under the same license") | Credit: RCSB Protein Data Bank (RCSB.org), data CC0 1.0. / Credit (zh): RCSB 蛋白質資料庫（RCSB.org），資料採 CC0 1.0。 |
| Journal feeds (Springer Nature, AAAS, PNAS, Cell Press, APS, NEJM, The Lancet, AEA, Cambridge, Springer, AMS, Wiley/AGU, Project MUSE, AOSIS) | None stated; one request a morning each | Site terms keep copyright with the publisher. The tracker shows titles and links only. HTS items are CC BY 4.0 | Credit: Article titles and links from <publisher>'s own RSS feed; each article belongs to its publisher. / Credit (zh): 論文標題與連結取自 <publisher> 自家的 RSS 訂閱；各篇論文權利屬其出版者。 |
| pubs.acs.org | Cloudflare challenge on every GET | | none (not read) |
| www.eurekalert.org | None stated | EurekAlert! terms of service; each release is its institution's | Credit: News releases posted on EurekAlert! by AAAS; each release belongs to its institution. / Credit (zh): 新聞稿取自 AAAS 經營的 EurekAlert!，各稿權利屬發布機構。 |
| Lab sites | None stated | Site terms; titles and links only | Credit: Posts from <lab>'s own site. / Credit (zh): 文章取自 <lab> 官方網站。 |
| www.sciencemediacentre.org | None stated | Its copyright page is 404 (K1d) | Credit: Expert reactions from the Science Media Centre (sciencemediacentre.org). / Credit (zh): 專家回應取自英國科學媒體中心（sciencemediacentre.org）。 |
| mathlib.org | None stated | Apache 2.0 | Credit: Statistics from the mathlib community (mathlib.org), Apache License 2.0. / Credit (zh): 統計數字來自 mathlib 社群（mathlib.org），採 Apache 2.0 授權。 |
| erdosproblems.com, GitHub teorth/erdosproblems | None stated | Apache 2.0 (the repository's LICENSE) | Credit: Erdős problems data from Thomas Bloom's erdosproblems.com and its GitHub data (Apache License 2.0). / Credit (zh): 艾狄胥問題資料來自 Thomas Bloom 的 erdosproblems.com 及其 GitHub 資料庫（Apache 2.0 授權）。 |
| scrollprize (Substack, scrollprize.org) | None stated | "Content licensed CC BY-NC 4.0" (site footer) | Credit: Vesuvius Challenge (scrollprize.org), content CC BY-NC 4.0. / Credit (zh): 維蘇威火山挑戰（scrollprize.org），內容採 CC BY-NC 4.0 授權。 |
| terms.naer.edu.tw | None stated | Its about page is 404 (K1d) | Credit: Terms from 樂詞網, National Academy for Educational Research. / Credit (zh): 詞彙取自國家教育研究院樂詞網。 |

Two notes on these lines before they go into `docs/SOURCES.md`:

- **arXiv:** its current API terms fix no credit wording. They put descriptive metadata under CC0 1.0,
  encourage linking to the abstract page, and forbid implying that arXiv endorses the project. The line
  above follows that.
- **PubMed:** NLM's preferred wording should be checked against NLM's own page.

## Not finished

- **The Tuesday and Wednesday arXiv check of the Sunday and Monday announcements.** Today is Saturday;
  the check needs those mornings.
- **The length of EurekAlert!'s daily summaries view.** I did not measure it.
- **The reuse terms of the Science Media Centre and 樂詞網.** Their terms pages answered 404, so they
  are left for K1d.
- **The counters' exact selectors** (mathlib, erdos), which K1d settles with the counter code.
