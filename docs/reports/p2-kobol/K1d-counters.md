# K1d: the counters' sources and the first AI-found drugs (P2, on Kobol)

Checked on 2026-11-28, from about 13:35 to 14:30 Taipei (05:35 to 06:30 UTC), on Kobol. All requests
were GETs with the run's user agent, at most one a second to any host (NCBI three), with no login and
no OpenAlex. `K1d-counters.json` holds the proposed `counters.json` values, the `full_bibles` figures
and the proposed `ai-drugs.json` entries. The answer shapes are in `samples/`, as numbers and field
names only.

## The seven counters

| Counter | Kind | How it is read | Reading today | Reads cleanly? |
|---|---|---|---|---|
| `erdos_ai` | **manual** (not api) | The repository's AI-contributions wiki | 69 problems, as of 2026-06-30 | No api route exists (below) |
| `mathlib_theorems` | api | `https://mathlib.org/mathlib_stats.html`: the first `table.table-borderless`, second row, second cell (Definitions, Theorems, Contributors) | 297,154 theorems | Yes. The date is only in a 2.5 MB script, so use the fetch date |
| `ai_drugs` | api | `ai-drugs.json` plus `studies?filter.ids=<ids>&pageSize=<n>&fields=NCTId,OverallStatus,Phase` | 5 drugs with the proposed entries: one at phase 1, two at phase 2, one at phase 3, one approved | Yes. `protocolSection.statusModule.overallStatus` and `protocolSection.designModule.phases` are confirmed |
| `pdb_structures` | api | The search API by deposit date, plus the holdings file of unreleased entries | 2025: 19,342. 2026 to 28 Nov: 20,718 | Yes (below) |
| `ai_retractions` | api | The Retraction Watch CSV through Crossref; the reason "Computer-Aided Content or Computer-Generated Content" | 2025: 1,276. 2026 so far: 280 | Yes, but the file is 68.4 MB (below) |
| `full_bibles` | manual | Wycliffe's statistics infographics, as `figures` | Four figures, from 724 (Sep 2022) to 776 (Aug 2025); value 20 | Yes, but the figures are in images, not text |
| `ancient_texts_ai` | ledger | The tracker's own findings | Nothing to fetch | Its `source_url` (`content/findings` on `main`) is 404 until P2 merges |

### `erdos_ai`: there is no api route

- **The data repository has no AI field.** `github.com/teorth/erdosproblems` has
  `data/problems.yaml`, 1,221 problems with the fields number, prize, informal_status, formal_status,
  status, formalized, oeis, forum, tags and comments. `data/statistics_history.csv` counts solved and
  formalized problems, but has no AI column either.
- **The website no longer shows statuses.** The repository's README says erdosproblems.com stopped
  showing them (its `blog:9` post).
- **The AI list is frozen.** It lives in the repository's wiki, "AI contributions to Erdős problems",
  which says it "is no longer updated" as of 30 June 2026.
- **So the counter becomes manual.** I propose value 69 with `as_of` 2026-06-30, and
  `source_url` the wiki page. 69 counts the distinct problems the wiki marks 🟢 (full resolution) in its
  primary-contribution sections:
  - 1(a) AI standalone: 19 rows.
  - 1(c) AI building on literature: 19.
  - 1(d) AI collaborating with humans: 37.
  - 1(b) AI alongside literature: none marked full.

  The wiki itself warns that it "is not a benchmark".
- **This changes the spec.** SPEC 5.7's "api, else manual" lands on manual, and this counter can no
  longer grow. That is worth a SPEC 0.4 row, and JL may prefer to retire the counter.

### `pdb_structures`: the holdings file works

- **Released entries by deposit date.** The search API counts released entries by deposit date with a
  GET and `?json=<query>` with `return_counts`: 17,052 for 2025, and 4,632 for 2026 up to 28 November.
- **Unreleased entries.** `https://files.rcsb.org/pub/pdb/holdings/unreleased_entries.json.gz` holds
  every unreleased entry with its deposit date in one keyless GET:
  - **Format:** 1.16 MB gzip, 16.1 MB of JSON, 36,382 entries, keyed by PDB id.
  - **A row:** `{ "status_code": "AUTH", "deposit_date": "2024-07-12T00:00:00+00:00", ... }`.
  - **Withdrawn entries** are in the same file, as `status_code` `WDRN` (17,898 of them).
  - **Other status codes:** HPUB, HOLD, AUTH, PROC, WAIT, REPL, AUCO, POLC and REFI.
- **The other two routes do not work.** The Data API's `holdings/unreleased` answers 400 without ids,
  and `https://www.rcsb.org/pages/unreleased` is a page drawn by script, with no CSV in its plain answer.
- **The totals, against wwPDB's own figures.** For 2025: 17,052 released plus 2,290 unreleased (not
  WDRN) makes 19,342. With the 1,644 withdrawn added it is 20,986, within 11 of wwPDB's own 20,975
  deposits for 2025, which counts withdrawn entries (https://www.wwpdb.org/stats/deposition, "Last
  Updated: 17 November 2026"). For 2026 so far: 4,632 plus 16,086 makes 20,718. wwPDB gave 20,605 on
  17 November.
- **The new feed.** So the registry needs a feed `rcsb-unreleased`: kind `file`, JSON (gzip),
  budget 1.
- **A cap problem.** Unzipped, the file is over `fetchFeed()`'s 5 MB cap, so the cap must apply to the
  gzip body, or this feed needs its own cap.

### `ai_retractions`

- **The file.** `https://gitlab.com/crossref/retraction-watch-data/-/raw/main/retraction_watch.csv`
  is 68,441,942 bytes with 74,173 rows. Its header row is:
  `Record ID,Title,Subject,Institution,Journal,Publisher,Country,Author,URLS,ArticleType,RetractionDate,RetractionDOI,RetractionPubMedID,OriginalPaperDate,OriginalPaperDOI,OriginalPaperPubMedID,RetractionNature,Reason,Paywalled,Notes,`
  The trailing comma makes an empty 21st column.
- **`RetractionNature`** takes four values: Retraction (68,706), Expression of concern (3,741),
  Correction (1,562) and Reinstatement (164).
- **`Reason`** is a list separated by `;`, each reason followed by one, such as
  `Concerns/Issues about Data;Investigation by Journal/Publisher;`. The computer-generated reason is
  exactly `Computer-Aided Content or Computer-Generated Content`. It appears in 9,567 rows of any kind.
- **Retractions with that reason, by the year of `RetractionDate`:** 2023: 5,622; 2024: 1,454;
  **2025: 1,276**; 2026 so far: 280. One row is dated 2027.
- **Dates** are `M/D/YYYY 0:00`. **DOIs** are bare, such as `10.1063/5.0352611`, or blank,
  "unavailable" or "Unavailable".
- **Reading it without 68 MB every Monday.** The response carries an `ETag`, and a GET with
  `If-None-Match` answered 304. A range request answered 206, but the file is not sorted by date, so a
  range cannot pick out the new rows. GitLab's commits API
  (`/api/v4/projects/crossref%2Fretraction-watch-data/repository/commits?per_page=1`) gives one commit
  each working day, titled "Retraction Watch data for YYYY-MM-DD". So: keep the last ETag and download
  only when it changes, with this feed's own body cap, as K1c noted.
- **Citation.** The README gives no fixed line. It says Crossref acquired the database from the Center
  for Scientific Integrity in 2023 and made it public. Proposed line: "Retraction Watch Database (Center
  for Scientific Integrity), made openly available by Crossref."

### `full_bibles`

The figures are drawn in infographics, not written in the page text. I read each image.

| `as_of` | Total | Page (`source_url`) | The image says |
|---|---|---|---|
| 2022-09-01 | 724 | https://wycliffe.net/global-scripture-access/2022-global-scripture-access/ | "Full Bible: 724", "September 2022" |
| 2023-09-01 | 736 | https://wycliffe.net/global-scripture-access/2023-global-scripture-access/ | "Full Bible: 736", "September 2023" |
| 2024-09-01 | 756 | https://wycliffe.net/global-scripture-access/ (the 2024 page is 404; its images are on the main page) | "Full Bible: 756", "September 2024" |
| 2025-08-01 | 776 | https://wycliffe.net/global-scripture-access/ | "Full Bible: 776", "August 2025"; the text says "As of 1 August, 2025" |

- **The counter's value** is 776 minus 756, so 20.
- **Dates:** only the 2025 figure has a day. The others give a month, written here as the 1st.
- **The seed's `source_url` has moved.** `https://www.wycliffe.net/resources/statistics/` redirects to
  `https://wycliffe.net/global-scripture-access/`.

## `ai-drugs.json`: five entries

Each quote was checked to appear verbatim in the text of the page fetched today. Each is 25 words or
fewer.

| id | Drug | Developer | AI basis (quoted) | Source | Trials (status, phases) | Stage |
|---|---|---|---|---|---|---|
| `rentosertib` | Rentosertib (ISM001-055, INS018_055) | Insilico Medicine | "rentosertib (formerly ISM001-055), a first-in-class AI-generated small-molecule inhibitor of TNIK" | https://www.nature.com/articles/s41591-025-03743-2 (Nature Medicine, 2025) | NCT05154240 (completed, 1), NCT05938920 (completed, 2), NCT05975983 (recruiting, 2), NCT07687459 (recruiting, 3) | 3 |
| `ism5411` | ISM5411 | Insilico Medicine | "a potentially first-in-class PHD 1/2 inhibitor for the treatment of inflammatory bowel disease (IBD) designed by its generative AI platform" | https://www.eurekalert.org/news-releases/1010336 (Insilico's own release) | NCT06012578 (completed, 1), NCT07265570 (recruiting, 2) | 2 |
| `ism6331` | ISM6331 | Insilico Medicine | "ISM6331, a potential best-in-class pan-TEAD inhibitor, as a preclinical candidate compound (PCC) generated by Chemistry42, its proprietary generative chemistry-driven molecule design engine" | https://www.eurekalert.org/news-releases/991924 | NCT06566079 (recruiting, 1 and 2) | 1 |
| `rec-4881` | REC-4881 | Recursion | "MEK1/2 inhibition to target FAP was identified using phenotypic insights by the Recursion OS." | https://www.recursion.com/pipeline | NCT05552755 (recruiting, 1 and 2), NCT06005974 (terminated, 2) | 2 |
| `baricitinib-covid-19` | Baricitinib for COVID-19 | BenevolentAI (the finding), Eli Lilly (the drug) | "we used BenevolentAI to search for approved drugs that could help, focusing on those that might block the viral infection process. We identified baricitinib" | https://pmc.ncbi.nlm.nih.gov/articles/PMC7137985/ (Lancet letter, 2020, PMC copy) | NCT04401579 (ACTT-2, completed, 3) | approved: FDA, 2022-05-10 |

Notes on the entries:

- **Baricitinib needs JL's decision.** AI found a new use for a drug already approved. Drugs@FDA
  (`www.accessdata.fda.gov/scripts/cder/daf/...ApplNo=207924`) lists SUPPL-6, "Efficacy-New
  Indication", approved 05/10/2022: the COVID-19 use. SPEC 4.11 asks for the drug's earliest approval,
  which is its 2018 approval for rheumatoid arthritis, an approval with no AI in it. JL decides whether a
  repurposed drug belongs and which approval it carries. Without it there are 4 entries.
- **REC-4881:** the quote says the Recursion OS identified the use. Elsewhere the page calls that
  platform "our AI-native product engine".

Left out, each for want of a quotable statement on a page I could read:

- ISM3412 and other Insilico candidates: Insilico's pipeline page is drawn by script.
- IAM1363 (Iambic): its pipeline page says nothing about AI for this drug itself.
- REC-617 (GTAEXS617), REC-994 and EXS-21546: Recursion's investor news answers 403.
- VRG50635 and BEN-8744: their pipeline pages are 404.
- Zasocitinib: its design was physics-based computation, which no page here calls AI.

## URLs in the configs

| Config | URL | Status | Says what the config claims? |
|---|---|---|---|
| counters `erdos_ai` | https://www.erdosproblems.com/ | 200 | No longer: the site shows no statuses. Use the wiki above |
| counters `mathlib_theorems` | https://leanprover-community.github.io/mathlib_stats.html | 200, "Page Moved" | Moved to https://mathlib.org/mathlib_stats.html |
| counters `ai_drugs` | https://clinicaltrials.gov/ | 200 | Yes (the home page is drawn by script; the API is what is read) |
| counters `pdb_structures` | https://www.rcsb.org/ | 200 | Yes |
| counters `ai_retractions` | https://gitlab.com/crossref/retraction-watch-data | 200 | Yes |
| counters `full_bibles` | https://www.wycliffe.net/resources/statistics/ | 200, after a redirect | Redirects to https://wycliffe.net/global-scripture-access/ |
| counters `ancient_texts_ai` | https://github.com/8gara8/UnveilingTracker/tree/main/content/findings | 404 | Not yet: the folder appears when P2 merges |
| markers, 2020-11-30 | https://predictioncenter.org/casp14/ | 200 | CASP14's home page. It is the event's own page, but does not itself say that AlphaFold 2 led |
| markers, 2022-11-30 | https://openai.com/index/chatgpt/ | 200 | Yes ("Introducing ChatGPT") |
| markers, 2024-02-05 | https://scrollprize.org/grandprize | 200 | Yes ("Vesuvius Challenge 2023 Grand Prize awarded") |
| markers, 2024-10-09 | https://www.nobelprize.org/prizes/chemistry/2024/press-release/ | 200 | Yes |
| ai-drugs | the five `source_url` values above | 200 each | Yes (the quotes are verbatim) |
| ai-drugs, `approved` | Drugs@FDA, ApplNo 207924 | 200 | Lists the 05/10/2022 new indication |

## Not finished

- **The two newest ai-drugs ideas** (Iambic's IAM1363 and Recursion's REC-617) need a readable page
  that names AI for that drug.
- **The 2022 to 2024 Bible figures** carry a month only, not a day.
