# K1a: live checks of OpenAlex and the Pace seeds (P2, on Kobol)

Checked on 2026-11-28, from about 12:30 to 12:45 Taipei (04:30 to 04:45 UTC), on Kobol, with plain Node
`fetch` scripts kept outside the repo. Every request was sequential and paced at one per 1.1 seconds,
sent with the `user_agent` of `config/run.json`, with no `mailto`, no key and no personal data. In all I
made 315 requests: 312 answered 200 and 3 answered 400. The three 400s were limit probes that were
expected to fail (101 values, `sample=10001`, a `group_by` on a date). Together they used 335 of the
1,000 credits a day that keyless callers get. No request was refused for rate or budget. The data files
next to this report hold every number quoted here:

- `journals-openalex.json`: the 22 journals
- `fields-openalex.json`: the fields
- `humanities-candidates.json` and `earth-candidates.json`: the candidates
- `api-checks.json`: the search, sample, limit and week checks
- `samples/<kind>.json`: the four weekly request kinds, as numbers and ids only

## The headline: keyless access is now budgeted, and the backfill does not fit

OpenAlex has changed its access rules since the spec was written. A keyless request still works, but
every response says:

> "No API key, so this request shares one free daily budget ($0.10) with everyone on your network's IP address."

From OpenAlex's docs (help.openalex.org, which docs.openalex.org now redirects to):

- `access/example-costs`: "Without a key you get $0.10/day". A free key gives $1 a day. The budget
  resets at midnight UTC (08:00 Taipei).
- The same page, on the price of each operation:
  - List and filter: $0.10 per 1,000 calls (1 credit each).
  - Search: $1 per 1,000. That covers "any `.search` filter".
  - Group by: "$0.10 on a list, $1 on a search".
- `api/authentication`, per-second limits with no key: 10 requests a second in general, and 1 a second
  for "Searches with more than 5 `AND`/`OR`/`NOT` operators". The 20-phrase OR search has 19, so it
  falls under this limit. With no key, "the limits count per IP address".
- The same page: a free key "is required for cursor paging past the first page".
- The same page, on new accounts: "A new free account spends its first $1 at up to $0.10 every 5 minutes".
- The response headers carry the budget: `x-ratelimit-limit: 1000`, `x-ratelimit-remaining`,
  `x-ratelimit-credits-used` and `x-ratelimit-reset` (seconds to midnight UTC).

What that means for SPEC 5.1 and 5.4:

- **A week costs 22 credits:** `leading_total` and `all_total` cost 1 credit each, and `leading_ai`
  and `all_ai` cost 10 each.
- **The backfill does not fit keyless.** From 2015-01-05 to now is about 620 weeks, so about 13,600
  credits ($1.36). The spec's "about 2,500 requests, under an hour at one a second" is still true of
  the requests and the time. But keyless caps the backfill at about 45 weeks a day, so it would take
  about 14 days. With a free key it takes 2 days ($1 a day), and the cache keeps it resumable. Paging
  past the first page also needs a key.
- **The morning run fits keyless, narrowly.** 9 weeks a morning is 36 requests and about 198 credits,
  20% of the keyless daily budget. That budget is shared with every caller on Kobol's IP address,
  including any browsing of openalex.org. CyberTracker's code (the read-only copy at
  `~/.unveiling/cyber-base`) does not call OpenAlex.
- **P2's precision and recall samples** (§10 P2 step 2) are searches at 10 credits each. They fit in a
  day with a key, and only barely without one.

I did not run the 200-request volume test. It would have spent most of the day's shared keyless budget
for nothing the headers do not already say. I created no key and no account.

Two other things in the API's answers:

- The keyless notice in each response, and OpenAlex's agent docs, suggest that an agent request a key
  by sending the user's email to `POST https://api.openalex.org/api-keys`. I did not do that. It is
  JL's choice whether to make a free key and store it with the helper (`--openalex`, SPEC 9.6), and
  JL's step.
- The docs also say that "The `mailto` parameter is ignored" since the polite pool ended in February
  2026, so the spec's "no `mailto`" costs nothing.

## Verify items

| Item | What was done | Result | What the spec or config must change |
|---|---|---|---|
| 1. Keyless access and volume | Read the docs and the response headers; 315 paced keyless requests of every shape below | All 200 apart from the 3 intended 400s. No 429. Keyless budget is $0.10 a day, 1,000 credits, per IP. Search and search group-by cost 10 credits, list and group-by 1 | The backfill needs about 13,600 credits: 14 days keyless or 2 days with a free key. SPEC 5.1's fallback applies in its "if OpenAlex now needs a key" form: JL makes a free key and stores it with `store-token.zsh --openalex`, the client adds `api_key=`, and `inputs` strips it. That needs a SPEC 0.4 row. SPEC 5.4's "under an hour" should say "about 13,600 credits, two days on a free key, resumable from the cache". Paging past page 1 needs a key |
| 2. `GET /fields` | 1 request, every id and name compared with `fields.json` | 26 fields, ids 11 to 36, each mapped exactly once (7 lists plus `excluded` 17, 22, 21). None missing, none extra, none renamed. Field 12 "Arts and Humanities" sits in OpenAlex's Social Sciences domain, which matters nowhere in our mapping | None |
| 3. Journals | `GET /sources/issn:<issn>` for all 22, and `GET /sources/<id>` for the 10 real seed ids (both free) | All 22 ISSNs resolve to the intended journal. All 10 real seed ids are correct. All 12 placeholders now have real ids (table below). Minor differences: OpenAlex names "New England Journal of Medicine" (no "The") and "Inventiones mathematicae" (lower-case m). The Lancet's `issn_l` is 0099-5355 and Nature Biotechnology's is 0733-222X; our ISSNs are in their `issn` lists | Replace the 12 placeholders. Keep our names: they are display names, and matching is by id. Keep our ISSNs: each is a valid ISSN of the journal |
| 4. Yearly counts and `in_pace` | Two `group_by=publication_year` requests per journal, 2015 to 2025, `type:article`, with and without `has_abstract:true`; SPEC 4.11's test applied exactly | 12 pass, 10 fail (list below). Nature Human Behaviour fails. Earth is left with no in_pace journal of its own | Set the 10 to `in_pace` false and add earth journals (below). Then see "A problem with the in_pace test" below: the test as written passes journals with almost no abstracts in 2015 to 2019 |
| 5. Humanities journals | Candidate pool from `/sources?filter=topics.field.id:12` by citations and from grouping humanities articles by journal; 16 candidates tested | 5 picks under the stated rule (below): Language, Antiquity, The Classical Quarterly, Journal of Biblical Literature, HTS Teologiese Studies / Theological Studies | Add the 5 to `journals.json` with `fields` ["humanities"] and `in_pace` true. Write the rule into SPEC 4.11. Philosophy has no pick: every leading philosophy journal fails for missing abstracts |
| 6. Search syntax, NOT, sample and seed | `title_and_abstract.search` built exactly as SPEC 5.1 says, on 2019 articles with abstracts; phrase, hyphen and NOT probes; `sample` with `seed` | Works. The 20-phrase OR finds 63,291 of 3,749,447 articles (1.7%), plausible for 2019. A quoted phrase matches as a phrase, and words are stemmed. A hyphen counts as a space. `NOT` works inside the filter. `sample` with `seed` works with these filters, and the same seed gives the same works. The maximum sample is 10,000 | None for the syntax. P2 can use `NOT` to find a phrase alone, and `sample` with `seed` for its draws, with no client-side paging. Note that matching is stemmed: "neural network" also matches "neural networks" |
| 7. 100-value limit and `doi:` | `primary_location.source.id` with 100 and with 101 values; `doi:` with 100 real Nature DOIs in three forms | 100 values: 200. 101 values: 400, "Maximum number of values exceeded for primary_location.source.id. Decrease values to 100 or below". `doi:` takes the bare lower-case form (`10.1038/s41586-021-03819-2`), the bare original-case form and the `https://doi.org/` form. Each returned all 100 works in one request (1 credit), with `doi` as `https://doi.org/10...` and `primary_topic.field.id` as `https://openalex.org/fields/13` | None. Use the bare form: the URL is 2,779 bytes against 4,379 with the prefix, both well under the 8,190-byte limit. Strip `https://openalex.org/fields/` from the answer's field id |
| 8. Group-by consistency | Week 2026-09-07 to 2026-09-13 (11 weeks back), the four kinds with `group_by=primary_topic.field.id` and ungrouped, using the 20 journals proposed for `in_pace` true | Every kind is within 1%: leading_total 464 of 466 (0.43%), leading_ai 27 of 27, all_total 87,076 of 87,209 (0.15%), all_ai 6,518 of 6,519. The gap is works with no primary topic; `:include_unknown` shows 133 in all_total, exactly the gap. No unmapped key. Excluded keys (17, 22, 21): 41, 4, 12,495 and 2,320 | Record the no-topic works in `inputs` along with the excluded ones (`group_by` hides them by default) |
| 9. Other differences | Weekly ungrouped all_total for the 12 newest full weeks; date group-by; `per-page` | See "Other findings" below: month-start bunching of publication dates, no visible indexing lag, group-by capped at 200 groups, no group-by on dates, `per-page` accepted | SPEC 5.4: weekly counts need a rule for works dated only to a month (below) |

## Journals: the 12 placeholders, and each journal's result

The ids below are the ones that `/sources/issn:<issn>` returns, each checked by name.

| id | Placeholder | OpenAlex source | OpenAlex name |
|---|---|---|---|
| annals-of-mathematics | S9999999901 | S45918994 | Annals of Mathematics |
| nature-physics | S9999999902 | S156274416 | Nature Physics |
| nature-chemistry | S9999999903 | S202193212 | Nature Chemistry |
| nature-materials | S9999999904 | S103895331 | Nature Materials |
| jacs | S9999999905 | S111155417 | Journal of the American Chemical Society |
| nature-biotechnology | S9999999906 | S106963461 | Nature Biotechnology |
| nature-geoscience | S9999999907 | S48977010 | Nature Geoscience |
| nature-climate-change | S9999999908 | S183584863 | Nature Climate Change |
| nature-human-behaviour | S9999999909 | S2764866340 | Nature Human Behaviour |
| inventiones | S9999999910 | S98347115 | Inventiones mathematicae |
| jams | S9999999911 | S130224168 | Journal of the American Mathematical Society |
| acta-mathematica | S9999999912 | S113542759 | Acta Mathematica |

The 10 seeded ids are all correct. Nature S137773608, Science S3880285, Cell S110447773, PNAS
S125754415, PRL S24807848, Nature Medicine S203256638, NEJM S62468778, The Lancet S49861241, AER
S23254222 and APSR S176007004 each resolve by ISSN to the same id.

**Proposed `in_pace`, by SPEC 4.11's test as written.** The test asks for a with-abstract article in
every year from 2015 to 2025. In each year, the count must be at least half the 2015 to 2019 yearly
mean, and the share must be at least half the 2015 to 2019 share. Each journal's yearly counts are in
`journals-openalex.json`.

True (12):

- Nature
- Science
- Cell
- PNAS
- Physical Review Letters
- Annals of Mathematics
- Nature Chemistry
- JACS
- NEJM
- Nature Biotechnology
- American Political Science Review
- Journal of the AMS

False (10), with the reason:

- **Nature Physics:** 2016 had 1 article with an abstract against a mean of 6.0.
- **Nature Materials:** 2017 had no article with an abstract.
- **Nature Medicine:** 2015 had none. 2016 and 2017 had 1 each against a mean of 3.6.
- **The Lancet:** 2023 had 49 against a mean of 108.8.
- **Nature Geoscience:** 2015 had none.
- **Nature Climate Change:** 2015 had 1 against a mean of 3.0, a share of 0.3% against 1.1%.
- **American Economic Review:** 2023 had 85 against a mean of 200.8. The AER's article count fell from
  about 270 a year in 2015 to 2017 to about 110 from 2018. That fits the AEA's Papers and Proceedings
  leaving the AER in 2018, which inflates the 2015 to 2019 mean.
- **Nature Human Behaviour:** none in 2015, 2016 and 2018, as SPEC 4.11 requires.
- **Inventiones Mathematicae:** 2016 had 4 against a mean of 8.8, a share of 5.6% against 12.6%.
- **Acta Mathematica:** 2025 had 5 against a mean of 11.4. It falls below half by a fraction of one
  paper: Acta prints about 10 articles a year.

After these, SPEC 5.1's rule leaves one field with no in_pace journal whose `fields` is that field
alone: **earth**. Mathematics still has Annals and JAMS, physics PRL, chemistry Nature Chemistry and
JACS, biology Cell, NEJM and Nature Biotechnology, and social science APSR. The humanities get their own
picks below.

**Earth picks.** The rule is the same as for the humanities, with fields 19 and 23 in place of 12. The
pool is journals with at least 60% of their topics in those fields, found by
`/sources?filter=topics.field.id:19|23,type:journal&sort=cited_by_count:desc`. Each must pass the
in_pace test, have an abstract on at least half its 2015 to 2019 articles, and average at least 20 a
year. Rank by `cited_by_count` and take the top 3.

| Rank | Source | Journal | ISSN-L | Citation share among eligible | 2015 to 2019 abstract share |
|---|---|---|---|---|---|
| 1 | S207178839 | Journal of Geophysical Research: Atmospheres | 0148-0227 | 37.1% | 92.9% |
| 2 | S13479253 | Environmental Science & Technology | 0013-936X | 24.9% | 99.0% |
| 3 | S36624081 | Geophysical Research Letters | 0094-8276 | 15.6% | 99.8% |
| 4 | S204847658 | Water Resources Research | 0043-1397 | 9.2% | 99.9% |
| 5 | S80591372 | Journal of Climate | 0894-8755 | 6.7% | 99.9% |
| 6 | S162708223 | Atmospheric Chemistry and Physics | 1680-7316 | 6.5% | 99.9% |

The citation shares are over these six eligible journals.

One caution: OpenAlex's JGR: Atmospheres record carries the old all-sections JGR ISSN 0148-0227 as its
ISSN-L, so its citation count likely includes legacy JGR. In `journals.json` give it the ISSN
2169-897X, which is also in its `issn` list. If the cloud session would rather not rank on that
record, Water Resources Research is the next pick.

Some journals failed the test for want of abstracts in 2015 to 2019: Science of the Total Environment,
Water Research, Geochimica et Cosmochimica Acta and Earth and Planetary Science Letters.

## A problem with the in_pace test as written

SPEC 4.11's test is relative: each year against the journal's own 2015 to 2019 level. So it passes
journals that OpenAlex holds almost no abstracts for in 2015 to 2019:

| Journal | Abstract share in 2015 to 2019 | Abstract share in 2025 |
|---|---|---|
| Nature | 3.3% | 30% |
| Nature Chemistry | 0.5% | 35% |
| Cell | 10% | 51% |
| Nature Biotechnology | 3.9% | 24% |

Because `has_abstract:true` sits in both A's numerator and its denominator, these journals count for
very little in the baseline and much more after about 2021, when OpenAlex's abstracts for Springer
Nature and Cell Press titles grow. Nature goes from 87 with-abstract articles a year in 2015 to 2019 to
1,009 in 2025. So A compares one set of journals in name but a different mix in fact. Any difference in
AI share between those titles and the rest moves A with no change in the science.

Two possible fixes, for the cloud session and JL to choose between:

- **An absolute floor:** a journal's abstract share must be at least 50% in every year from 2015.
  Under that floor these pass: Science, PNAS, PRL, Annals, JACS, NEJM, APSR, JAMS, the three earth picks
  and the five humanities picks. Nature, Cell, Nature Chemistry and Nature Biotechnology would leave A.
  Every field would still have an in_pace journal of its own: chemistry by JACS, biology by NEJM.
- **Weighting each journal by its article count.** This is a bigger change to SPEC 5.1.

I recommend the floor. It needs a SPEC 0.4 row and a sentence in SPEC 4.11. Science's article count
also drops from about 3,400 a year to about 1,400 from 2022; its with-abstract count drops less (from
about 2,200 to about 1,300). That still passes, but is worth noting.

## Humanities: the rule and the picks

**Rule (proposed for SPEC 4.11).**

- **Pool:** journals (OpenAlex source type journal) with at least 60% of their listed OpenAlex topics
  in field 12, Arts and Humanities. I found them by
  `/sources?filter=topics.field.id:12,type:journal&sort=cited_by_count:desc` (the first 1,000) and by
  grouping 2015 to 2019 humanities articles with abstracts by journal. The grouping covered seven
  subfields: religious studies, philosophy, history, language and linguistics, classics, archaeology,
  and literature.
- **Eligible:** a journal passes the SPEC 4.11 in_pace test, has an abstract on at least 50% of its
  2015 to 2019 articles, and averages at least 20 articles with abstracts a year in 2015 to 2019.
- **Ranking:** by OpenAlex `cited_by_count`. The citation share is a journal's count over the total of
  the eligible journals.
- **Picks:** the top 5, at most 2 from one OpenAlex subfield.

OpenAlex totals citations across a result set only on its website for now, so the API rule ranks on
the source record's own `cited_by_count`.

| Rank | Source | Journal | ISSN-L | Citation share | 2015 to 2019 abstract share | Mean with abstracts a year | Covers |
|---|---|---|---|---|---|---|---|
| 1 | S176347361 | Language | 0097-8507 | 50.9% | 71.9% | 46 | languages |
| 2 | S173880072 | Antiquity | 0003-598X | 19.1% | 85.8% | 130 | archaeology |
| 3 | S4210173305 | The Classical Quarterly | 0009-8388 | 15.5% | 95.0% | 79 | ancient texts |
| 4 | S55827047 | Journal of Biblical Literature | 0021-9231 | 9.6% | 89.6% | 52 | scripture |
| 5 | S52609742 | HTS Teologiese Studies / Theological Studies | 0259-9422 | 4.9% | 99.0% | 246 | theology |

The other candidates, and why each is out:

- **The Journal of Roman Studies:** passes the test, but averages 10.8 with abstracts a year.
- **The Journal of Philosophy:** passes the test, but only 46% of its 2015 to 2019 articles have abstracts.
- **The Philosophical Review:** fails in 2024 and 2025, when its abstracts fall away in OpenAlex.
- **Mind:** fails in 2022.
- **Synthese, Philosophical Studies and Critical Inquiry:** fail for few abstracts in 2015.
- **The American Historical Review:** fails in 2021 and 2023. Its abstracts drop to 42 in 2023.
- **Past & Present:** fails in 2023.
- **Religions (MDPI):** fails because it grew from 92 articles in 2015 to 1,562 in 2025, so its early
  years fall below half its mean.
- **Journal of the American Oriental Society:** has almost no works in OpenAlex before 2021.

Every candidate's counts are in `humanities-candidates.json`. Philosophy and literature have no pick:
OpenAlex lacks abstracts for their leading journals in some years. HTS, an open-access South African
journal, is the weakest pick by citations. It is there for theology, which design v0.4 names.

## Other findings

- **Works dated to a month bunch on the 1st.** Ungrouped `all_total` for recent weeks runs at about
  87,000 to 92,000 a week. The three weeks that hold a 1st of the month are much higher: 161,832 for
  2026-08-31, 190,964 for 2026-09-28 and 151,710 for 2026-10-26. OpenAlex gives works with only a month
  (or only a year) a `publication_date` on the 1st (or 1 January). So weekly counts have a spike every
  month and a bigger one each January, and a week's share mixes in papers from the rest of the month.
  The share is a ratio, so the spikes partly cancel, but SPEC 5.4 should state how it treats them. For
  example, it could keep them as they are and say so, or note the January effect on the year-ago window.
- **No visible indexing lag in the counts.** The newest full week, 2026-11-16, already counts 87,950,
  level with weeks two months older. Works still change after indexing (topics, abstracts), so the 8
  provisional weeks remain sensible. But "OpenAlex indexes papers weeks late" is not visible in the raw
  weekly totals.
- **Group-by caps at 200 groups.** `groups_count` was 200 for the journal groupings. Grouping by field
  (26 keys) is not affected.
- **No group-by on a date:** "Cannot group by date, number, or search fields."
- **`per-page` with a hyphen is accepted** (per-page=7 gave 7). The docs write `per_page` and say 100
  is the supported maximum. 200 still works, but is deprecated.
- **Requests the spec doesn't make:** the default works corpus excludes OpenAlex's "expansion"
  records (`corpus=all` adds them), and source-level `works_count` includes them. None of SPEC 5.1's
  requests depends on that.
- **The search answers carry their own reading.** `meta.x_query.oql` showed each phrase searched
  "stemmed" and each request "in the title or abstract", not the keywords. A request's own OQL could
  go into `inputs` as a record of what was counted.
