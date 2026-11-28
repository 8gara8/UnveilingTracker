# K1d: the rest of the allowlist, the labs, the checkers, the markers and E-utilities types (P2, on Kobol)

Checked on 2026-11-28, from about 14:00 to 14:30 Taipei (06:00 to 06:30 UTC), on Kobol, with the snapshot
step's plain GET: the same headers, a 15 s timeout, 5 redirects and a 3 MB cap, at one request a second
to any host. `K1d-allowlist-rest.json` holds each proposed change with its evidence URLs.

## `statement_suffixes`

**Each body's host is its own site and answered 200 with readable content:**

- **Bible translation bodies:** wycliffe.net, unitedbiblesocieties.org, and sil.org (which redirects
  to global.sil.org, still under the host).
- **The Holy See:** vatican.va. Its 2025 note on AI, *Antiqua et nova*, is at
  `/roman_curia/congregations/cfaith/documents/...` and readable.
- **Institutions:** mpg.de, cnrs.fr, riken.jp, sinica.edu.tw, home.cern, embl.org, ethz.ch,
  nationalacademies.org and royalsociety.org.

**The publishers' newsrooms:**

| Entry | Result |
|---|---|
| group.springernature.com/gp/group/media/press-releases | 200, readable |
| elsevier.com/about/press-releases | 200, readable |
| cell.com/newsroom | **403, a Cloudflare challenge**: it can be listed but not snapshotted |
| aaas.org/news | 200, readable |
| elifesciences.org/for-the-press | 200, readable |
| newsroom.wiley.com | 200, redirects to `/newsroom-home/default.aspx` |

**Country forms: add `.edu.tw`.** Taiwan's universities are under `.edu.tw`, and
www.ntu.edu.tw and www.nthu.edu.tw both answered 200. No listed form covers them. I also propose
`.edu.cn`, `.edu.hk`, `.edu.sg` and `.edu.au`, the academic forms of China, Hong Kong, Singapore and
Australia, which the news names often.

A limit no suffix can fix: universities in Germany, Canada, the Netherlands, France and the Nordic
countries use plain country domains, such as `uni-heidelberg.de` or `utoronto.ca`. Each needs a host
entry of its own, or its release is cited through `eurekalert.org/news-releases/`.

## `reaction_sources`

| Entry | Hosts | Paths | Evidence |
|---|---|---|---|
| `smc` (change) | as seeded | `/expert-reaction-` **and `/experts-react-`** | https://www.sciencemediacentre.org/expert-reaction-to-natsal-4-as-published-in-the-lancet/ ; the feed also carries `/experts-react-to-...` |
| `aussmc-scimex` (new) | www.scimex.org, scimex.org | `/newsfeed/expert-reaction-` | https://www.scimex.org/newsfeed/expert-reaction-cop31-climate-talks-fail-to-reach-agreement |
| `smc-nz` (new) | www.sciencemediacentre.co.nz | `/20` | https://www.sciencemediacentre.co.nz/2026/11/23/cop31-climate-talks-collapse-expert-reaction/. Posts are dated paths, and a prefix cannot pick out the reactions, so `/20` admits briefings too |
| `smc-de` (new) | www.sciencemediacenter.de | `/angebote/` | https://www.sciencemediacenter.de/angebote/neue-hormontherapie-verhindert-mehr-brustkrebs-rueckfaelle-26291. Statements by named scientists, in German |
| `smc-es` (new) | sciencemediacentre.es | `/` | Reactions are slugs at the root, listed at `/reacciones`, so the path cannot be narrowed |
| `smc-taiwan` (new) | smctw.tw | `/` | https://smctw.tw/20444/ (「COP31會後」專家意見). Taiwan's centre, in Traditional Chinese, with numbered posts at the root. Useful for the Chinese pass |
| `terence-tao` | terrytao.wordpress.com | keep `/`, or narrow to `/20` (posts are `/YYYY/MM/DD/slug/`) | 200, "What's new", his own blog |

The Canadian centre (sciencemediacentre.ca) served almost no text to a plain GET, so I did not add it.

## `labs.json`

Each lab's own recent post answered 200 and was readable. Meta's showed "captcha" in its scripts but
was a real page.

| Lab | Post (evidence) | Proposed |
|---|---|---|
| google-deepmind | https://deepmind.google/blog/interpreting-mass-spectra-with-google-antigravity/ | As is |
| openai | https://openai.com/index/gpt-6-models-demonstrate-intrinsic-protein-design-capabilities/ | As is |
| anthropic | https://www.anthropic.com/research/early-progress-drug-development | As is (research at `/research/`, news at `/news/`) |
| meta-fair | https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/ | `paths` `/blog/` and `/research/publications/`. `/research/` is a product page today, and the blog is all of Meta AI, not FAIR alone |
| microsoft-research-ai-for-science | https://www.microsoft.com/en-us/research/blog/breaking-bonds-breaking-ground-advancing-the-accuracy-of-computational-chemistry-with-deep-learning/ | Narrow `paths` to `/en-us/research/lab/microsoft-research-ai-for-science/`, `/en-us/research/blog/` and `/en-us/research/publication/`. `/en-us/research/` alone admits every Microsoft Research page. The blog is shared, so it still admits other groups' posts |
| futurehouse | https://www.futurehouse.org/research/demonstrating-end-to-end-scientific-discovery-with-robin-a-multi-agent-system | As is |
| periodic-labs | https://periodic.com/news/building-labs-that-learn | As is (posts at `/news/`) |
| isomorphic-labs | https://www.isomorphiclabs.com/articles/isomorphic-labs-enters-into-a-research-collaboration-with-msd | As is (posts at `/articles/`; `/news` is the list) |
| lila-sciences | https://www.lila.ai/news/seeing-molecules-from-any-direction | As is (lila.ai redirects to www.lila.ai) |
| sakana-ai | https://sakana.ai/marlin/ | As is (posts are root slugs) |
| arc-institute | https://arcinstitute.org/news/virtual-cell-challenge-2026-wrap-up | As is |
| allen-institute-for-ai | https://allenai.org/blog/where-scientists-draw-the-line-on-ai-agents | As is |

## `checkers.json`

| Checker | Record page (200 unless said) | Note |
|---|---|---|
| nobel-prize | https://www.nobelprize.org/prizes/chemistry/2024/summary/ | Records under `/prizes/` |
| breakthrough-prize | https://breakthroughprize.org/Laureates/1 | `/Laureates/` |
| fields-medal | https://www.mathunion.org/imu-awards/fields-medal | `/imu-awards/` |
| abel-prize | https://abelprize.no/abel-prize-laureates/2025 (listed on the index) | `/abel-prize-laureates` without a year is 404 |
| wolf-prize | https://wolffund.org.il/the-wolf-prize/ | |
| kavli-prize | https://www.kavliprize.org/laureates | `/prizes` is 404 |
| lasker-awards | https://laskerfoundation.org/winners/ | |
| casp | https://predictioncenter.org/casp16/ | |
| fda | https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=207924 | Drugs@FDA records at `/scripts/cder/daf/`, letters and labels at `/drugsatfda_docs/` |
| ema | https://www.ema.europa.eu/en/medicines/human/EPAR/olumiant | `/en/medicines/human/EPAR/` |
| taiwan-fda | https://www.fda.gov.tw/TC/index.aspx ; https://mcp.fda.gov.tw/ | Both 200; no approval record sampled |
| pmda | https://www.pmda.go.jp/english/ | No approval record sampled |
| vesuvius-challenge | https://scrollprize.org/grandprize | |
| erdosproblems | https://www.erdosproblems.com/ | The site no longer shows statuses. The data is at `github.com/teorth/erdosproblems`, so add that host and path to this checker |
| lean-mathlib-docs | | Add host `mathlib.org`. The statistics page moved to `mathlib.org/mathlib_stats.html` |

## `markers.json`

All four `source_url` values answer 200:

- **ChatGPT:** OpenAI's own "Introducing ChatGPT" says what the marker says.
- **Vesuvius Challenge:** "Vesuvius Challenge 2023 Grand Prize awarded" says it.
- **Nobel Prize:** the 2024 Chemistry press release says it.
- **CASP14:** the page is the event's home page, and it does not itself say AlphaFold 2 led. It is still
  the event's own primary page, so I would keep it.

No replacement is needed.

## E-utilities: reading PubMed and PMC types without the record pages

As K1b found, PubMed's record pages answer a cookie check and PMC's show no type. E-utilities give both,
within NCBI's limit of 3 requests a second. The sample is `samples/eutils-types.json`.

- **PubMed.**
  - **Request:** `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=<pmid>`.
  - **Answer:** `result.<pmid>.pubtype` is an array. `result.<pmid>.articleids[]` also gives the PMC
    id, under `idtype` "pmc".
  - **Seen, for one 2024 record of each kind:** research `["Journal Article"]`; review
    `["Journal Article","Review"]`; editorial `["Editorial"]`; news `["News"]`; commentary
    `["Journal Article","Comment"]`.
- **PMC.**
  - **Request:** `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=<number without "PMC">`.
  - **Answer:** JATS XML, with the type in the `article-type` attribute of the root `<article>`.
  - **Seen, for the same five records:** `research-article`, `review-article`, `editorial`, `news` and
    `article-commentary`.
  - **Size:** the answer holds the full text, about 100 KB an article, so the step should ask for one id
    at a time and cap the body.
- **`refused_pubtypes` holds.** "News", "Editorial" and "Comment" are exactly PubMed's strings, and
  "news", "editorial" and "article-commentary" are exactly PMC's. A commentary record carries both
  "Journal Article" and "Comment", and is refused because one of its types is listed, as SPEC 4.11
  intends.

So the snapshot step can type a cited PubMed URL by its PMID through esummary, and a PMC URL by its
number through efetch. That needs a SPEC 0.4 row, since SPEC 4.14 has the types come from the page.
