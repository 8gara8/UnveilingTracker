# K2b: evidence cards for 30 more Landmark Ledger candidates (P2, on Kobol)

Checked on 2026-11-28, from about 15:15 to 15:40 Taipei (07:15 to 07:40 UTC), on Kobol. I used the same
script and method as K2 (see `K2-summary.md`), run on `docs/reports/p2-ledger/K2b-input.json`:

- **Fetching:** plain GET with the run's user agent, 15 s, 5 redirects, a 3 MB cap, and one request a
  second to any host (arXiv 3 s, NCBI 3 a second).
- **Checking:** Crossref for every DOI, and open copies in PMC, Europe PMC, bioRxiv and arXiv.
- **Passages:** up to six from each readable page.
- **Dead or blocked pages:** Crossref and arXiv title searches. This is new in K2b; the results are in
  each card under `title_search`.

Page text stays outside the repo. The outputs:

- **`ledger-cards/<slug>.json`:** one card for each of the 30 new slugs. No K2 card was overwritten.
- **`K2b-summary.json`:** one row for each of the 145 items, in input order.
- **`K2b-rechecks.json`:** the three rechecks.

Every one of the 653 passages appears word for word in its page's extracted text.

## Counts

- **URLs:** 136 unique, from 145 items. Status classes:
  200: 117, 2xx other: 2, 4xx: 13, 404/410: 2, no answer: 2.
  113 are readable.
- **DOIs:** 59 checked in Crossref. All of them resolve, and none is wrong.
- **Placeholder title:** one draft title was a placeholder ("title not read"). Crossref's real title is
  in its card.
- **Item verdicts:** unreadable 23, usable 120, dead 2.
- **Title searches:** run for each of the 23 unreadable or dead items. Six found the same work under
  the same DOI: the IUPAC report and two of its Chemistry International pieces, the Lancet ring-trial
  paper, and the PsyArXiv preprint of the conspiracy-dialogue study. None found a different, readable
  page.
- **Readable open copies:** none of the unreadable items has one in PMC, Europe PMC, bioRxiv or arXiv.
- **Dates:** 40 items are dated more than 31 days from `first_published`. As in K2,
  these are mostly the later trials, approvals and reactions a candidate cites.
- **Titles:** three items have a title that differs from the draft's. In each case the draft gave a
  description rather than the page's own title:
  - a Stanford Medicine release;
  - CEGA's Togo page;
  - the Morocco microcredit paper on DSpace.

  The pages are the right ones.

**Candidates:** 5 ok, 25 partial, 0 bad.

## Hosts that refused the plain GET

| Host | Why (count) |
|---|---|
| www.degruyterbrill.com | 202 AWS WAF challenge (2) |
| www.iupac.org | 403 Cloudflare challenge (1) |
| www.ornl.gov | 403 Cloudflare challenge (1) |
| www.anl.gov | 403 Cloudflare challenge (1) |
| pubs.aip.org | 403 Cloudflare challenge (1) |
| www.monash.edu | 403 Cloudflare challenge (1) |
| linkinghub.elsevier.com | 200 too little text (JS shell or empty) (1) |
| www.fda.gov | 404 (2) |
| breakthroughprize.org | 200 too little text (JS shell or empty) (1) |
| www.ox.ac.uk | 403 Cloudflare challenge (1) |
| www.noaa.gov | 403 (1) |
| techpartnerships.noaa.gov | 403 (1) |
| www.aims.gov.au | TimeoutError (2) |
| www.jpl.nasa.gov | 403 (2) |
| dare.uva.nl | 200 too little text (JS shell or empty) (1) |
| www.science.org | 403 Cloudflare challenge (1) |
| osf.io | 200 too little text (JS shell or empty) (1) |
| www.scimex.org | 403 Cloudflare challenge (1) |
| www.diamond.ac.uk | 403 Cloudflare challenge (1) |

Dead: two FDA pages for sotorasib (404). As in K2, FDA moved its older pages, so the Drugs@FDA record
should replace them. The two `www.aims.gov.au` pages timed out at 15 s.

Several government and laboratory sites now answer a plain GET with a Cloudflare 403:

| Kind | Sites |
|---|---|
| Laboratories and agencies | NOAA, JPL, ORNL, Argonne, Diamond Light Source, IUPAC |
| Universities | Oxford, Monash |
| Science Media Centre | Scimex |

So their statements can be cited but not snapshotted. SPEC 4.12's snapshot step will record them as
unreadable.

## Candidates

| Slug | Verdict | Items that fall short (role, i: verdict and reason) |
|---|---|---|
| four-new-elements-complete-seventh-row | partial | source 0: unreadable (202 AWS WAF challenge); source 1: unreadable (202 AWS WAF challenge); source 2: usable, date off (2014-05-01); source 3: usable, date off (2010-04-09) (+2 more) |
| borophene-two-teams-make-2d-boron | partial | source 1: usable, date off (2015-07-17); source 3: unreadable (403 Cloudflare challenge); source 4: usable, date off (2016-04-25); reaction 0: usable, date off (2016-04-25) |
| lk-99-independent-checks-no-superconductivity | partial | source 0: unreadable (403 Cloudflare challenge), date off (2023-10-01) |
| rigorous-test-electric-ammonia-claims-lithium | partial | source 1: usable, date off (2020-11-02); source 2: usable, date off (2021-11-21); source 3: unreadable (403 Cloudflare challenge) |
| neural-networks-solve-schrodinger-equation-molecules | partial | source 1: usable, date off (2020-09-16); source 3: usable, date off (2019-12-06); source 4: usable, date off (2021-11-30) |
| ebola-vaccine-ervebo-ring-trial | partial | source 0: usable, date off (2026-04-21); source 1: usable, date off (2019-12-12); source 2: usable, date off (2019-10-18); source 3: usable, date off (2017-01-31) (+1 more) |
| sotorasib-first-kras-drug-approved | partial | source 1: dead (404); source 2: dead (404) |
| prime-editing-rewrites-dna-no-breaks | partial | source 2: usable, date off (2019-12-12); source 3: usable, date off (2020-06-10); source 4: unreadable (200 too little text (JS shell or empty)); source 5: usable, date off (2025-04-05) |
| speech-neuroprostheses-stanford-ucsf-2023 | partial | source 4: usable, title mismatch |
| r21-malaria-vaccine-who-prequalified | partial | source 3: unreadable (403 Cloudflare challenge) |
| noaa-ai-global-weather-models-operational | partial | source 0: unreadable (403) |
| deepmind-cyclone-model-hurricane-center-use | partial | source 2: unreadable (403) |
| great-barrier-reef-2016-mass-bleaching | partial | source 1: unreadable (TimeoutError); source 2: unreadable (TimeoutError) |
| aegis-ai-picks-mars-laser-targets | partial | source 0: unreadable (403); source 1: unreadable (403) |
| score-project-social-science-replicability | partial | source 6: usable, date off (2026-05-31); reaction 0: usable, date off (2026-05-31) |
| ai-chatbot-chats-shift-voter-preferences | partial | source 1: usable, date off (2025-07-18); source 5: usable, date off (2024-03-21); source 7: unreadable (200 too little text (JS shell or empty)); reaction 1: unreadable (200 too little text (JS shell or empty)) |
| chatgpt-beats-crowd-workers-text-labels | partial | source 1: usable, date off (2023-07-17); source 2: usable, date off (2023-04-13); source 3: usable, date off (2024-01-01); source 4: usable, date off (2023-04-17) (+1 more) |
| phone-data-targets-cash-aid-togo | partial | source 2: usable, date off (2021-06-30); source 3: usable, title mismatch; source 4: usable, date off (2026-06-16) |
| ai-dialogues-reduce-conspiracy-beliefs | partial | source 0: unreadable (403 Cloudflare challenge); source 1: unreadable (200 too little text (JS shell or empty)); source 4: usable, date off (2025-10-13); source 5: unreadable (403 Cloudflare challenge) (+1 more) |
| generative-ai-assistant-raises-support-productivity | partial | source 2: usable, date off (2023-02-13); source 3: usable, date off (2023-07-14) |
| replication-nature-science-social-experiments | ok |  |
| six-microcredit-trials-find-modest-effects | partial | source 1: usable, date off (2013-04-30); source 2: usable, date off (2014-04-30); source 3: usable, date off (2013-05-31); source 4: usable, title mismatch |
| growth-mindset-national-experiment-ninth-graders | ok |  |
| moral-machine-self-driving-car-choices | ok |  |
| entire-herculaneum-scroll-read-first-time | partial | source 3: unreadable (403 Cloudflare challenge) |
| minoans-mycenaeans-ancient-dna-aegean-farmers | partial | source 2: usable, date off (2022-05-15); source 3: usable, date off (2023-01-15) |
| old-kingdom-egyptian-genome-nuwayrat | ok |  |
| nllb-200-translates-200-languages | partial | source 0: usable, date off (2023-05-08); source 1: usable, date off (2024-06-04) |
| kalambo-falls-earliest-wooden-structure-476000 | ok |  |
| sulawesi-oldest-narrative-cave-art-51200 | partial | source 2: usable, date off (2025-08-13) |

## Rechecks (`K2b-rechecks.json`)

1. **Kakeya, the 2026 Fields Medals page.**
   - **The page:** answers 200 but carries too little text for a snapshot. Neither "Kakeya" nor "Wang"
     is in its HTML.
   - **Hong Wang's citation:** only a PDF,
     https://www.mathunion.org/fileadmin/documents/2026-07/Hong_Wang_Citations.pdf.
   - **Terence Tao's post of 2025-02-25:** readable, with Kakeya 68 times, Wang 18, Zahl 16, Guth 5 and
     UCLA 2. Up to 10 passages are given.
2. **Halicin.**
   - **The three F1000 (Faculty Opinions) reviews:** each DOI resolves in Crossref and lands on
     facultyopinions.com/prime/737402248, which answers 403. Neither the reviewer nor an affiliation
     can be read.
   - **Later papers:** Europe PMC finds 34 papers on halicin with none of Stokes, Collins or Barzilay as
     authors. The ten most cited are listed. The two most cited open ones were read in PMC, with
     passages:
     - 10.3390/pharmaceutics12121189 (2020), on delivering halicin in electrospun fibres;
     - 10.3390/antibiotics10121480 (2021), on its antibacterial efficacy.
3. **Steppe ancestry.**
   - **Saag et al. 2017:** 10.1016/j.cub.2017.06.022 (Current Biology, Elsevier, July 2017). No PMC
     copy and no preprint were found.
   - **Allentoft et al. 2015 (10.1038/nature14507):** no open preprint, and no PMC copy found. Only the
     Nature page remains, which nature.com serves to a plain GET.
