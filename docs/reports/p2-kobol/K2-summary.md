# K2: evidence cards for the Landmark Ledger's candidate sources (P2, on Kobol)

Checked on 2026-11-28, from about 13:55 to 14:50 Taipei (05:55 to 06:50 UTC), on Kobol. One node script
(kept outside the repo) fetched every URL of `docs/reports/p2-ledger/K2-input.json` the way the
snapshot step will: a plain GET, the run's user agent, 15 s, 5 redirects, a 3 MB cap, and one request a
second to any host (arXiv 3 s, NCBI 3 a second).

Each DOI was checked in Crossref with no email. For unreadable or blocked pages, I looked for open
copies in PMC (through the ID converter and Europe PMC), bioRxiv and arXiv. The script took up to six
passages per readable page from the page's own extracted text. A second pass then read the DOI from
publisher URLs (`/doi/10...`, eLife article numbers), read PubMed records through `esummary`, and
read ClinicalTrials.gov records through its API.

Page text stays outside the repo. The cards hold only the passages and a meta description of 300
characters or fewer.

- **`ledger-cards/<slug>.json`:** one card for each of the 125 candidates, with every source's fetch
  result, dates, Crossref record, type, passages, open copies and null-url matches.
- **`K2-summary.json`:** one row for each of the 418 items, in input order.

I checked every passage in the cards word for word against the extracted page text (1,412 of 1,412 at
first count). One limit: the extracted text sometimes runs a heading into the next sentence where the
page had no space between elements, such as "DeepMind.Discussion and conclusionWe have". The writers
should trim such joins at the ends of a passage, and change nothing else.

## Counts

**URLs and pages**
- **Unique URLs:** 368, from 418 items.
- **Status classes:** 200: 270, 4xx: 80, 404/410: 7, 2xx other: 10, no answer: 1.
- **Readable** (200, HTML, XML or text, and at least 1,000 characters of text): 248.
- **Not readable:** 120, including the PDFs, which were not read.

**DOIs**
- **Checked in Crossref:** 208. 206 resolve.
- **Not in Crossref:** 10.1101/2022.06.03.494563 and 10.5281/zenodo.10813168. The Zenodo DOI is a DataCite DOI, so it
  is not wrong. The bioRxiv one was read from a `.full.pdf` URL and not rechecked.
- **Wrong DOIs:** none.
- **Titles that differ from the draft's:** 4. Each is a placeholder in the draft ("title not read",
  "exact title not recalled") or another version of the same work (arXiv 1708.04202, whose page names
  the Nature paper's DOI). Crossref's real title is in each card.

**Items**
- **Verdicts:** usable 272, unreadable 68, usable_via_open_copy 59, dead 9, unresolved 10.
- **Items with a readable open copy:** 55.
- **Null-url items:** 4 of 13 resolved to a matching work:
  - the NBER working paper w26164;
  - the Economic Inquiry paper 10.1111/ecin.12992;
  - the PsyArXiv response 10.31234/osf.io/2amjz;
  - Linear Elamite, Zeitschrift für Assyriologie 10.1515/za-2022-0003.

  Six have no title at all in the input, so they could not be searched.
- **Items with a date more than 31 days from the candidate's `first_published`:** 172.
  Most are honest, not errors: the later confirmation, prize page, approval or reaction that a
  candidate cites to reach its rung. Each card gives every date found, with its source.

**Candidates:** 26 ok, 94 partial, 5 bad. Partial is
mostly a blocked page with no open copy, or a date more than 31 days off.

## Hosts that refused the plain GET

| Host | Why (count) |
|---|---|
| www.fda.gov | 404 (5); pdf (1) |
| www.ema.europa.eu | pdf (1); 404 (1) |
| people.mpim-bonn.mpg.de | pdf (1) |
| actu.epfl.ch | 200 Cloudflare challenge (1) |
| www.science.org | 403 Cloudflare challenge (48) |
| breakthroughprize.org | 200 too little text (JS shell or empty) (1) |
| academic.oup.com | 403 Cloudflare challenge (4) |
| eprints.whiterose.ac.uk | pdf (1) |
| chemrxiv.org | 403 Cloudflare challenge (1) |
| www.cmu.edu | 404 (1) |
| linkinghub.elsevier.com | 200 too little text (JS shell or empty) (7) |
| pubmed.ncbi.nlm.nih.gov | 203 cookie wall (record read through esummary) (10) |
| clinicaltrials.gov | page drawn by script; record read through the API (3) |
| www.nejm.org | 403 Cloudflare challenge (11) |
| www.accessdata.fda.gov | pdf (2) |
| directorsblog.nih.gov | ENOTFOUND (1) |
| chembiophd.hms.harvard.edu | 403 (1) |
| www.bmj.com | 403 Cloudflare challenge (1) |
| www.biorxiv.org | pdf (1) |
| pnas.org | 403 Cloudflare challenge (7) |
| agupubs.onlinelibrary.wiley.com | 403 Cloudflare challenge (1) |
| www.pnas.org | 403 Cloudflare challenge (3) |
| besjournals.onlinelibrary.wiley.com | 403 Cloudflare challenge (1) |
| journals.sagepub.com | 403 Cloudflare challenge (2) |
| elifesciences.org | 200 client challenge (JavaScript) (2) |
| predictingthepast.com | 200 too little text (JS shell or empty) (1) |

**What contradicts the spec, or needs a decision**

1. **Science's pages are the largest gap.** www.science.org answers 403 with a Cloudflare challenge to
   every page (48 URLs). With no PMC or arXiv copy, these Ledger sources cannot be snapshotted:
   boron arsenide, cyclocarbon, White Sands, Maya lidar, Upano, InSight, Hayabusa2, the ozone and
   fishing papers. Other Science sources have open copies: GraphCast and New Horizons on arXiv, En-Gedi
   in PMC. SPEC 4.12 and 8.13's `--verify` need a snapshot, so these candidates need another source:
   a readable statement, a PMC copy, or the NASA, JAXA or university release.
2. **PubMed record pages** answer 203 (a cookie wall). I read them through `esummary`, which gives
   the pubtype, the DOI and the PMC id, as K1d proposed.
3. **ClinicalTrials.gov pages are drawn by script.** The API record (`/api/v2/studies/<NCT>`) reads
   cleanly.
4. **Elsevier links** (linkinghub) stop at a meta refresh and carry too little text. The Lancet Oncology
   MASAI papers have no open copy found.
5. **Dead links:** the FDA press releases (5) are 404, `directorsblog.nih.gov` no longer resolves (2),
   and one CMU news page is 404. The FDA moved its old releases. The Drugs@FDA records and approval
   letters are the primary records to use instead.

## Candidates

| Slug | Verdict | Failing items (role, i: verdict and reason) |
|---|---|---|
| unit-distance-conjecture-disproved | partial | source 0: usable, date off (2026-11-18) |
| kakeya-conjecture-three-dimensions | ok |  |
| sphere-packing-dimensions-8-and-24 | partial | source 0: usable, date off (2017-01-01); source 2: usable, date off (2017-01-01); source 4: usable, date off (2026-04-25); reaction 0: usable, date off (2016-07-07) |
| polynomial-freiman-ruzsa-conjecture-proved | partial | source 1: usable, date off (2025-01-01) |
| alphaproof-imo-2024-silver-level | partial | source 1: usable, date off (2025-06-03) |
| exponential-improvement-diagonal-ramsey-numbers | partial | source 1: usable, date off (2026-01-01); source 2: usable, date off (2024-07-26); source 3: usable, date off (2025-01-18); reaction 0: usable, date off (2024-07-26) (+1 more) |
| hodge-theory-matroids-rota-conjecture | partial | source 1: usable, date off (2018-01-01); source 2: usable, date off (2020-02-09); reaction 0: usable, date off (2020-02-09) |
| alphaevolve-matrix-multiplication-kissing-number | partial | source 1: usable, date off (2025-06-16); source 2: usable, date off (2025-06-16); source 3: usable, date off (2025-11-03); reaction 0: usable, date off (2025-06-16) |
| liquid-tensor-experiment-lean-complete | partial | source 2: unreadable (pdf) |
| alphatensor-matrix-multiplication-algorithms | partial | source 2: usable, date off (2022-12-02); reaction 0: usable, date off (2022-12-02) |
| erdos-1196-primitive-sets-ai-proof | partial | source 2: usable, date off (2026-05-04) |
| sensitivity-conjecture-proved-huang | partial | source 1: usable, date off (2019-01-01); source 3: usable, date off (2019-08-17); source 4: usable, date off (2019-12-11); reaction 1: usable, date off (2019-08-17) (+1 more) |
| kelley-meka-three-term-progressions-bounds | partial | source 1: usable, date off (2023-09-05); reaction 0: usable, date off (2023-09-05) |
| gauss-lean-sphere-packing-formalisation | partial | source 0: usable, date off (2026-04-25); source 2: unreadable (200 Cloudflare challenge) |
| imo-2025-gold-level-ai | ok |  |
| erdos-728-factorial-divisibility-ai-lean | ok |  |
| gw170817-neutron-star-merger-light | ok |  |
| pulsar-timing-gravitational-wave-background | ok |  |
| jwst-confirms-galaxies-beyond-redshift-ten | partial | source 2: usable, date off (2023-03-27); source 3: usable, date off (2023-03-27) |
| magic-angle-graphene-superconductivity | partial | source 2: usable, date off (2018-08-23); source 3: usable_via_open_copy (403 Cloudflare challenge), date off (2019-03-08); source 4: usable, date off (2019-03-15); source 5: usable, date off (2020-01-16) |
| loophole-free-bell-tests-2015 | partial | source 2: usable, date off (2015-11-10); source 3: usable, date off (2015-12-16); source 4: usable, date off (2015-11-10); source 5: usable, date off (2015-12-16) |
| macroscopic-drumheads-entangled-2021 | partial | source 1: usable_via_open_copy (403 Cloudflare challenge), date off (2021-05-07); source 2: usable, date off (2020-09-27); source 3: unreadable (403 Cloudflare challenge), date off (2021-05-07) |
| muon-g-2-fermilab-confirms-brookhaven | partial | source 2: usable, date off (2006-02-20); source 3: usable, date off (2025-06-03) |
| weyl-semimetal-first-observed-taas | partial | source 1: usable_via_open_copy (403 Cloudflare challenge), date off (2015-08-07); source 3: usable, date off (2015-07-31) |
| pauli-blocking-light-scattering-fermions | partial | source 3: usable_via_open_copy (403 Cloudflare challenge), date off (2021-11-19); source 4: unreadable (403 Cloudflare challenge), date off (2021-11-19) |
| gw150914-first-gravitational-waves | ok |  |
| eht-m87-black-hole-shadow | partial | source 2: usable, date off (2022-10-21); source 3: unreadable (200 too little text (JS shell or empty)) |
| h3s-superconductivity-203-kelvin | partial | source 2: unreadable (403 Cloudflare challenge), title mismatch; source 3: usable_via_open_copy (403 Cloudflare challenge), date off (2019-05-09); source 4: usable, date off (2015-09-10) |
| dart-asteroid-orbit-changed | ok |  |
| logical-qubits-atom-array-processor | partial | source 2: usable, date off (2024-04-02) |
| thorium-229-nuclear-clock-laser-excitation | partial | source 2: usable, date off (2024-06-26) |
| top-quark-entanglement-atlas-cms | partial | source 2: usable, date off (2024-06-06); source 3: usable, date off (2024-10-23) |
| sycamore-quantum-advantage-claim | partial | source 1: usable, date off (2021-06-28); source 2: usable, date off (2021-10-25); source 3: usable, date off (2021-11-04); source 4: usable, date off (2022-08-22) |
| willow-error-correction-below-threshold | ok |  |
| deepmind-rl-tokamak-plasma-control | partial | source 2: usable, date off (2023-07-12); source 3: usable, date off (2023-07-21) |
| nif-fusion-target-gain-above-one | partial | source 0: usable, date off (2024-02-05); reaction 0: unreadable (pdf) |
| alphaqubit-neural-quantum-decoder | partial | source 1: usable, date off (2025-12-08) |
| gluon-amplitudes-nonzero-ai-conjecture | partial | source 1: usable, date off (2026-11-20); source 2: usable, date off (2026-03-27); reaction 0: usable, date off (2026-11-20) |
| boron-arsenide-high-thermal-conductivity | bad | source 0: unreadable (403 Cloudflare challenge); source 1: unreadable (403 Cloudflare challenge); source 2: unreadable (403 Cloudflare challenge) |
| pet-depolymerase-enzyme-plastic-recycling | partial | source 1: usable, date off (2025-09-23) |
| ai-retrosynthesis-planning-blind-test | partial | source 2: usable, title mismatch |
| gnome-millions-of-crystal-structures-predicted | partial | source 3: usable, date off (2024-04-07); source 4: unreadable (403 Cloudflare challenge), title mismatch; reaction 0: usable, date off (2024-04-07); reaction 1: unreadable (403 Cloudflare challenge) |
| a-lab-autonomous-synthesis-new-materials | partial | source 2: usable, date off (2023-04-17); source 3: unreadable (403 Cloudflare challenge), title mismatch; reaction 0: unreadable (403 Cloudflare challenge) |
| mobile-robot-chemist-photocatalyst-search | ok |  |
| coscientist-language-model-agent-runs-chemistry | partial | source 2: usable, date off (2023-04-11); source 3: dead (404) |
| computer-planned-natural-product-syntheses | ok |  |
| dm21-neural-network-density-functional | partial | source 0: unreadable (403 Cloudflare challenge) |
| closed-loop-machine-learning-fast-charging | ok |  |
| active-learning-copper-aluminium-co2-catalyst | ok |  |
| mattergen-generative-model-designs-crystals | ok |  |
| fast-petase-machine-learning-plastic-enzyme | ok |  |
| mof-water-harvesting-from-desert-air | partial | source 0: unreadable (403 Cloudflare challenge); source 1: usable_via_open_copy (403 Cloudflare challenge), date off (2018-05-31) |
| halicin-deep-learning-antibiotic-discovery | ok |  |
| cyclocarbon-18-ring-made-and-imaged | bad | source 0: unreadable (403 Cloudflare challenge), date off (2019-09-20) |
| alphafold2-casp14-protein-structure-prediction | partial | source 0: usable, date off (2021-05-11); source 1: usable_via_open_copy (203 cookie wall (record read through esummary)), date off (2021-08-01); source 2: usable_via_open_copy (203 cookie wall (record read through esummary)), date off (2021-10-19) |
| rentosertib-ai-drug-lung-fibrosis-trial | partial | source 2: usable, date off (2023-06-26) |
| ai-flagged-baricitinib-covid-treatment | partial | source 1: usable_via_open_copy (403 Cloudflare challenge), date off (2021-03-04) |
| masai-trial-ai-mammography-screening-sweden | partial | source 0: unreadable (203 cookie wall (record read through esummary)); source 1: unreadable (203 cookie wall (record read through esummary)), date off (2025-03-01) |
| idx-dr-first-autonomous-ai-diagnostic | partial | source 0: dead (404), title mismatch; source 1: usable, date off (2018-05-28) |
| covid-19-mrna-vaccines-efficacy-trials | partial | source 0: usable_via_open_copy (203 cookie wall (record read through esummary)), date off (2020-12-31); source 2: usable_via_open_copy (403 Cloudflare challenge), date off (2021-02-04); source 3: dead (404), title mismatch; source 4: unreadable (pdf) |
| crispr-sickle-cell-therapy-casgevy-approved | partial | source 0: unreadable (203 cookie wall (record read through esummary)), date off (2021-01-21); source 1: unreadable (403 Cloudflare challenge), date off (2021-01-21); source 2: usable, date off (2023-12-08); source 4: unreadable (403 Cloudflare challenge), title mismatch |
| lenacapavir-twice-yearly-hiv-prevention-injection | partial | source 0: unreadable (203 cookie wall (record read through esummary)), date off (2024-10-03); source 1: unreadable (pdf); source 2: unreadable (pdf); source 3: usable, title mismatch |
| semaglutide-obesity-step-1-trial-wegovy | partial | source 0: unreadable (203 cookie wall (record read through esummary)), date off (2021-03-18); source 1: usable, date off (2021-05-01); source 2: unreadable (pdf); source 3: usable, date off (2024-08-14) |
| trikafta-triple-therapy-cystic-fibrosis | partial | source 0: usable_via_open_copy (403 Cloudflare challenge), date off (2019-11-07); source 3: dead (ENOTFOUND) |
| ebola-antibody-drugs-palm-trial-approved | partial | source 0: usable_via_open_copy (403 Cloudflare challenge), date off (2019-12-12); source 1: dead (ENOTFOUND); source 2: dead (404), title mismatch |
| paxlovid-nirmatrelvir-cuts-covid-hospitalisation-trial | partial | source 0: usable_via_open_copy (403 Cloudflare challenge), date off (2022-04-14); source 1: usable_via_open_copy (403 Cloudflare challenge), date off (2022-08-31); source 2: usable, date off (2023-05-25) |
| lecanemab-slows-early-alzheimers-disease-trial | partial | source 0: unreadable (403 Cloudflare challenge), date off (2023-01-05); source 1: usable, date off (2023-07-06) |
| zolgensma-gene-therapy-spinal-muscular-atrophy | partial | source 0: unreadable (403 Cloudflare challenge); source 1: unreadable (403 Cloudflare challenge), date off (2017-12-22); source 2: usable, date off (2019-05-24) |
| luxturna-gene-therapy-inherited-blindness-approved | partial | source 1: dead (404), title mismatch; source 2: unreadable (403 Cloudflare challenge), date off (2017-12-22) |
| kymriah-car-t-childhood-leukaemia-approved | partial | source 0: usable_via_open_copy (403 Cloudflare challenge), date off (2018-01-31); source 1: dead (404), title mismatch |
| rts-s-malaria-vaccine-first-approved | partial | source 0: usable_via_open_copy (200 too little text (JS shell or empty)), date off (2015-06-30); source 1: dead (404), date off (2023-01-11), title mismatch |
| base-editing-changes-single-dna-letters | partial | source 1: usable, date off (2016-12-19); source 2: unreadable (403), title mismatch |
| development-tracked-cell-by-cell-2018 | partial | source 1: usable_via_open_copy (403 Cloudflare challenge), date off (2018-05-31); source 2: usable_via_open_copy (403 Cloudflare challenge), date off (2018-05-31); source 3: usable_via_open_copy (403 Cloudflare challenge), date off (2018-05-31); source 4: unreadable (403 Cloudflare challenge) |
| covid-ai-models-unfit-for-use | partial | source 1: usable, date off (2020-08-20) |
| alphafold-database-open-protein-structures | partial | source 3: usable, date off (2021-12-17), title mismatch; source 4: usable, date off (2021-12-17) |
| personalised-base-editing-therapy-infant-kj | ok |  |
| ai-designed-proteins-rfdiffusion-proteinmpnn | partial | source 0: usable_via_open_copy (403 Cloudflare challenge), date off (2022-10-07); source 1: usable, date off (2022-09-14); source 2: unreadable (pdf); source 3: usable, date off (2022-12-14) (+1 more) |
| rosettafold-three-track-protein-structure-prediction | partial | source 0: usable_via_open_copy (403 Cloudflare challenge), date off (2021-08-20); source 1: usable, date off (2021-07-14); source 3: usable, date off (2021-07-15) |
| alphafold3-predicts-biomolecular-complexes | partial | source 2: usable, date off (2024-11-26) |
| alphamissense-predicts-harm-of-missense-variants | partial | source 0: unreadable (203 cookie wall (record read through esummary)); source 1: unreadable (403 Cloudflare challenge); source 3: unresolved |
| complete-human-genome-sequence-t2t | partial | source 0: usable_via_open_copy (403 Cloudflare challenge), date off (2022-03-31); source 1: usable, date off (2022-07-09) |
| fruit-fly-brain-wiring-map-flywire | partial | source 0: usable, date off (2023-07-11); source 1: usable, date off (2023-07-14) |
| ecmwf-aifs-first-operational-ai-forecast | partial | source 1: usable, date off (2024-06-03); source 2: usable, date off (2023-07-19) |
| graphcast-ai-ten-day-weather-forecast | partial | source 0: usable_via_open_copy (403 Cloudflare challenge), date off (2023-12-22); source 2: usable, date off (2021-08-31); source 3: usable, date off (2023-07-19) |
| pangu-weather-3d-neural-network-forecast | partial | source 0: usable, date off (2023-01-05); source 2: usable, date off (2023-07-19) |
| cfc11-unexpected-emissions-traced-to-china | partial | source 1: usable, date off (2018-11-15) |
| imbie-antarctic-ice-loss-tripled | partial | source 1: usable_via_open_copy (403 Cloudflare challenge), date off (2019-01-14) |
| german-flying-insect-biomass-decline | partial | source 1: usable, date off (2019-02-08); source 2: unreadable (403 Cloudflare challenge), date off (2020-04-24) |
| insight-seismometer-maps-interior-of-mars | partial | source 0: unreadable (403 Cloudflare challenge); source 1: unreadable (403 Cloudflare challenge); source 2: unreadable (403 Cloudflare challenge); source 3: usable_via_open_copy (403 Cloudflare challenge), date off (2023-04-24) |
| climate-sensitivity-range-narrowed-multiple-evidence | partial | source 0: usable_via_open_copy (403 Cloudflare challenge), date off (2020-09-25) |
| hayabusa2-ryugu-samples-carbonaceous-organic | partial | source 0: unreadable (403 Cloudflare challenge); source 1: unreadable (403 Cloudflare challenge), date off (2023-2-24); source 2: unreadable (403 Cloudflare challenge), date off (2023-2-24); source 3: usable, date off (2024-07-25) |
| camera-trap-deep-learning-wildlife | partial | source 0: usable_via_open_copy (403 Cloudflare challenge), date off (2018-6-5); source 2: unreadable (403 Cloudflare challenge), date off (2018-11-26) |
| bennu-samples-ammonia-nucleobases-ancient-brine | partial | source 2: unreadable (403 Cloudflare challenge), date off (2023-2-24) |
| antarctic-ozone-layer-healing-emerges | partial | source 0: unreadable (403 Cloudflare challenge) |
| ai-maps-global-fishing-footprint | partial | source 0: unreadable (403 Cloudflare challenge); source 1: usable, date off (2017-02-08), title mismatch |
| hunga-tonga-eruption-global-waves | partial | source 0: unreadable (403 Cloudflare challenge), date off (2022-7); source 1: usable, date off (2022-02-28) |
| new-horizons-pluto-flyby-results | partial | source 0: usable_via_open_copy (403 Cloudflare challenge), date off (2015-10-16); source 1: usable, title mismatch |
| gencast-ai-ensemble-weather-forecast | partial | source 0: usable, date off (2024-04-30) |
| osc-2015-psychology-replication-project | partial | source 0: unreadable (403 Cloudflare challenge); source 1: unreadable (403 Cloudflare challenge), date off (2016-03-04); source 2: usable, date off (2016-02-25); source 3: usable_via_open_copy (403 Cloudflare challenge), date off (2016-06-30) (+3 more) |
| many-analysts-one-dataset-red-cards | partial | source 0: unreadable (403 Cloudflare challenge); source 1: unreadable (200 too little text (JS shell or empty)), date off (2021-06-30); source 2: usable_via_open_copy (403 Cloudflare challenge), date off (2022-10-28) |
| language-models-simulate-survey-respondents | partial | source 0: usable, date off (2023-02-21); source 1: unreadable (200 too little text (JS shell or empty)), date off (2023-06-30); source 2: usable, date off (2024-05-17); source 3: usable, date off (2023-03-30) (+2 more) |
| nudge-meta-analysis-publication-bias-dispute | partial | source 1: usable_via_open_copy (403 Cloudflare challenge), date off (2022-07-19); source 2: usable_via_open_copy (403 Cloudflare challenge), date off (2022-07-19); reaction 0: usable_via_open_copy (403 Cloudflare challenge), date off (2022-07-19); reaction 1: usable_via_open_copy (403 Cloudflare challenge), date off (2022-07-19) |
| seshat-moralizing-gods-claim-and-dispute | partial | source 1: usable, date off (2019-05-02); source 3: usable_via_open_copy (403 Cloudflare challenge), date off (2017-12-21); reaction 0: usable, date off (2019-05-02); reaction 1: unresolved (no url) |
| meta-2020-election-feed-experiments | partial | source 0: unreadable (403 Cloudflare challenge); source 1: unreadable (403 Cloudflare challenge); source 3: unreadable (403 Cloudflare challenge); source 4: unresolved (no url) (+2 more) |
| ultra-poor-graduation-trial-six-countries | partial | source 0: unreadable (403 Cloudflare challenge); source 1: unreadable (403 Cloudflare challenge), date off (2017-03-20) |
| creating-moves-to-opportunity-voucher-trial | partial | source 1: unresolved (no url) |
| centaur-model-predicts-human-choices | partial | source 2: unresolved (no url); source 3: unresolved (no url); reaction 0: unresolved (no url); reaction 1: unresolved (no url) |
| vesuvius-challenge-reads-herculaneum-scroll | partial | source 0: usable, date off (2024-02-05); source 1: usable, title mismatch |
| steppe-ancestry-reshapes-europe-ancient-dna | ok |  |
| ithaca-restores-dates-greek-inscriptions | ok |  |
| white-sands-footprints-ice-age-people | bad | source 0: unreadable (403 Cloudflare challenge); source 1: unreadable (403 Cloudflare challenge), date off (2023-10-6) |
| maya-lidar-reveals-lowland-civilisation | bad | source 0: unreadable (403 Cloudflare challenge) |
| jebel-irhoud-earliest-homo-sapiens | partial | reaction 0: unresolved (no url) |
| homo-naledi-new-human-species | partial | source 1: usable_via_open_copy (200 client challenge (JavaScript)), date off (2017-5-9) |
| aeneas-latin-inscriptions-context-restoration | partial | source 1: unreadable (200 too little text (JS shell or empty)), title mismatch |
| denisovan-jawbone-tibetan-plateau-xiahe | partial | source 1: unreadable (403 Cloudflare challenge), date off (2020-10-30) |
| nazca-geoglyphs-ai-finds-303 | ok |  |
| en-gedi-scroll-read-without-opening | ok |  |
| aguada-fenix-oldest-largest-maya-monument | ok |  |
| upano-valley-amazon-garden-cities | bad | source 0: unreadable (403 Cloudflare challenge) |
| linear-elamite-script-deciphered | ok |  |
| arad-ostraca-handwriting-analysis-literacy | ok |  |
| akkadian-cuneiform-neural-machine-translation | ok |  |
| ai-dating-dead-sea-scrolls-enoch | ok |  |
| mms-speech-models-1100-languages | ok |  |
