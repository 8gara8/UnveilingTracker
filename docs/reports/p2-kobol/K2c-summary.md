# K2c: evidence cards for 114 more Landmark Ledger candidates (P2, on Kobol)

Checked on 2026-11-28, from about 20:34 to 21:20 Taipei (12:34 to 13:20 UTC), on Kobol. I used the K2
and K2b script and method (see `K2b-summary.md`), run on `docs/reports/p2-ledger/K2c-input.json`, with
the batch's three changes:

- **Passages by term:** each page keeps up to 10 passages, best first, that contain one of the item's
  `terms`. Each passage is one sentence copied word for word from the extracted text.
- **Search pages:** each of the 71 `search: true` items was fetched. Up to 3 result links per item were
  followed, on the same registered domain only, when the link text held at least two of the item's terms
  or of the candidate's title words. Each followed link is recorded under `extras`, with `via`.
- **Bylines and dates:** each card records the dates and the people the page itself shows
  (`dates_found`, `people_found`: citation_author, author, article:author, dc.creator). The
  proposers' `date_hint` and `who` are kept apart, as `date_hint` and `who_hint`.

Every DOI was checked in Crossref. Open copies were looked for in PMC, Europe PMC, bioRxiv and arXiv,
and dead or blocked pages got Crossref and arXiv title searches. The limits were the same as before:
plain GET, the run's user agent, 15 s, 5 redirects, 3 MB, and one request a second to any host (arXiv
3 s, NCBI 3 a second).

The cards are in the new folder `ledger-cards-c/<slug>.json`, one for each of the 114 candidates;
nothing in `ledger-cards/` was touched. `K2c-summary.json` has one row for each of the 361
items, in input order. Page text stays outside the repo.

All 1470 passages appear word for word in their page text (0
do not).

## Counts

- **URLs:** 353 unique, from 361 items. Status classes:
  200: 297, 4xx: 39, 2xx other: 4, no answer: 1, 404/410: 12. 261 are readable.
- **Item verdicts:** usable 270, unreadable 80, dead 11. In detail:
  usable 264, unreadable 72, mismatch 6, usable_via_open_copy 6, dead 11, unresolved 2.
- **Search pages:** 71 of 71 answered. They yielded 35 followed
  links, all 35 readable.
- **DOIs:** 150 checked in Crossref; 148 resolve. Two are not in Crossref:
  - `10.3886/ICPSR37353.v1`, an ICPSR DataCite DOI, which is not wrong.
  - **`10.1016/j.cell.2021.06.049`, which is wrong.** Crossref has no such work, and its title search
    found nothing like the candidate's paper.
- **Title differences:** six items. Four are descriptions in the draft, not page titles (a Faculty
  Opinions review, a Nature news piece, a Nature comment, the OSF preprint record of the Science paper).
  The other two are real: the two "UNREAD LEAD" Copernicus DOIs for IMBIE are other papers.
  - `10.5194/tc-15-233-2021` is "Review article: Earth's ice imbalance".
  - `10.5194/tc-19-1153-2025` is an age-depth study of Dronning Maud Land.

## Candidates with a confirming page or two reactions now readable

88 of the 114 candidates now have at least one readable confirming page (a paper,
preprint, notice, statement or checker page, read directly or through an open copy) or readable
reaction pages from at least two institutions. Search-page links count here only when they are expert
reactions. The list gives the readable confirming items (role, i) and the reaction hosts:

- a-lab-autonomous-synthesis-new-materials: confirming paper 4, paper 5, paper 6
- active-learning-copper-aluminium-co2-catalyst: confirming paper 1
- aeneas-latin-inscriptions-context-restoration: confirming preprint 2, paper 3, paper 4; reactions: nature.com
- aguada-fenix-oldest-largest-maya-monument: confirming paper 1, paper 2; reactions: nature.com
- ai-chatbot-chats-shift-voter-preferences: confirming paper 8, paper 9, paper 10
- ai-designed-proteins-rfdiffusion-proteinmpnn: confirming paper 7, paper 8, paper 9, paper 10, paper 11, paper 12; reactions: sciencemediacentre.org
- ai-dialogues-reduce-conspiracy-beliefs: confirming paper 7, paper 9, paper 16; reactions: sciencemediacentre.org expert-reaction-to-study-comparing-physi
- ai-maps-global-fishing-footprint: confirming statement 2, statement 3, paper 7
- ai-retrosynthesis-planning-blind-test: confirming paper 4, paper 5, paper 6, paper 7, paper 8
- akkadian-cuneiform-neural-machine-translation: confirming paper 1
- alphaevolve-matrix-multiplication-kissing-number: confirming statement 4, preprint 5, preprint 6, preprint 7, paper 9
- alphafold-database-open-protein-structures: confirming statement 5, paper 6, statement 7, paper 8, paper 9; reactions: sciencemediacentre.org
- alphafold3-predicts-biomolecular-complexes: confirming paper 3, paper 4, paper 5, paper 6, paper 7, paper 9, paper 10; reactions: sciencemediacentre.org, nature.com, sciencemediacentre.org expert-reaction-to-the-latest-version-of, sciencemediacentre.org expert-reaction-to-paper-on-google-deepm
- alphamissense-predicts-harm-of-missense-variants: confirming paper 4, paper 6, paper 7, paper 8, paper 9
- alphaproof-imo-2024-silver-level: confirming statement 2, paper 3, paper 4; reactions: terrytao.wordpress.com, nature.com
- alphaqubit-neural-quantum-decoder: confirming paper 3, paper 4, paper 5
- alphatensor-matrix-multiplication-algorithms: confirming paper 4, paper 5, paper 6
- antarctic-ozone-layer-healing-emerges: confirming statement 3
- arad-ostraca-handwriting-analysis-literacy: confirming paper 1
- base-editing-changes-single-dna-letters: confirming paper 4, paper 5
- bennu-samples-ammonia-nucleobases-ancient-brine: confirming paper 3, statement 5, paper 6, paper 7; reactions: nature.com
- camera-trap-deep-learning-wildlife: confirming paper 4, paper 5, paper 6
- centaur-model-predicts-human-choices: confirming paper 5; reactions: linkinghub.elsevier.com
- cfc11-unexpected-emissions-traced-to-china: confirming paper 3; reactions: sciencemediacentre.org expert-reaction-to-new-study-on-ozone-de
- chatgpt-beats-crowd-workers-text-labels: confirming paper 7
- climate-sensitivity-range-narrowed-multiple-evidence: confirming paper 2, paper 3, paper 4
- closed-loop-machine-learning-fast-charging: confirming paper 1
- complete-human-genome-sequence-t2t: confirming statement 2, paper 4, paper 8; reactions: sciencemediacentre.org expert-reaction-to-first-complete-sequen, sciencemediacentre.org expert-reaction-to-unpublished-preprint-, sciencemediacentre.org expert-reaction-to-a-wellcome-announceme
- computer-planned-natural-product-syntheses: confirming paper 1, paper 2
- coscientist-language-model-agent-runs-chemistry: confirming paper 4
- covid-ai-models-unfit-for-use: confirming paper 2, paper 3
- deepmind-rl-tokamak-plasma-control: confirming paper 4, paper 5
- development-tracked-cell-by-cell-2018: confirming paper 7
- ebola-antibody-drugs-palm-trial-approved: confirming paper 3
- en-gedi-scroll-read-without-opening: confirming statement 1, statement 2, paper 3
- erdos-1196-primitive-sets-ai-proof: confirming paper 3, paper 4
- erdos-728-factorial-divisibility-ai-lean: confirming paper 2, paper 3
- fast-petase-machine-learning-plastic-enzyme: confirming paper 3
- fruit-fly-brain-wiring-map-flywire: confirming paper 2, paper 3, paper 4
- gencast-ai-ensemble-weather-forecast: confirming paper 3, paper 4
- generative-ai-assistant-raises-support-productivity: confirming paper 4; reactions: sciencemediacentre.org expert-reaction-to-study-on-the-associat, sciencemediacentre.org expert-reaction-to-study-in-mice-suggest, sciencemediacentre.org expert-reaction-to-study-on-human-derive
- german-flying-insect-biomass-decline: no confirming page; reactions: sciencemediacentre.org expert-reaction-to-review-paper-looking-, sciencemediacentre.org expert-reaction-to-study-looking-at-clim, sciencemediacentre.org expert-reaction-to-study-of-insect-numbe
- gnome-millions-of-crystal-structures-predicted: confirming paper 5
- growth-mindset-national-experiment-ninth-graders: confirming paper 3
- gw150914-first-gravitational-waves: confirming paper 3; reactions: sciencemediacentre.org, sciencemediacentre.org expert-reaction-to-announcement-that-the, sciencemediacentre.org expert-reaction-to-announcement-on-gravi, sciencemediacentre.org expert-reaction-to-detection-of-gravitat
- hodge-theory-matroids-rota-conjecture: confirming statement 4
- idx-dr-first-autonomous-ai-diagnostic: confirming checker 4, paper 5
- imbie-antarctic-ice-loss-tripled: confirming paper 2, paper 3, paper 4; reactions: sciencemediacentre.org expert-reaction-to-research-on-antarctic
- imo-2025-gold-level-ai: confirming paper 4
- insight-seismometer-maps-interior-of-mars: confirming paper 4
- kelley-meka-three-term-progressions-bounds: confirming paper 3
- kymriah-car-t-childhood-leukaemia-approved: confirming checker 2, checker 3, paper 6
- lenacapavir-twice-yearly-hiv-prevention-injection: confirming checker 5, paper 7
- liquid-tensor-experiment-lean-complete: confirming statement 3
- lk-99-independent-checks-no-superconductivity: confirming paper 7, paper 9
- logical-qubits-atom-array-processor: confirming paper 3
- luxturna-gene-therapy-inherited-blindness-approved: confirming checker 3, paper 7
- macroscopic-drumheads-entangled-2021: confirming paper 4
- magic-angle-graphene-superconductivity: confirming checker 6, paper 7
- many-analysts-one-dataset-red-cards: confirming paper 5, paper 7
- mattergen-generative-model-designs-crystals: confirming paper 1, paper 2
- maya-lidar-reveals-lowland-civilisation: confirming paper 1
- minoans-mycenaeans-ancient-dna-aegean-farmers: confirming paper 4
- mobile-robot-chemist-photocatalyst-search: confirming paper 2
- mof-water-harvesting-from-desert-air: confirming statement 2, paper 3, paper 4
- nazca-geoglyphs-ai-finds-303: confirming paper 1, paper 3
- new-horizons-pluto-flyby-results: confirming paper 3
- nif-fusion-target-gain-above-one: confirming statement 2, statement 3; reactions: sciencemediacentre.org, nature.com, sciencemediacentre.org expert-reaction-to-systematic-review-and
- nllb-200-translates-200-languages: confirming paper 6
- nudge-meta-analysis-publication-bias-dispute: confirming paper 4, paper 5, paper 6, paper 7
- old-kingdom-egyptian-genome-nuwayrat: confirming paper 2
- osc-2015-psychology-replication-project: confirming paper 4
- personalised-base-editing-therapy-infant-kj: confirming paper 1; reactions: sciencemediacentre.org expert-reaction-to-study-on-new-crispr-g, sciencemediacentre.org expert-reaction-to-base-editing-revealin, sciencemediacentre.org expert-reaction-to-mhra-authorising-gene
- pet-depolymerase-enzyme-plastic-recycling: confirming paper 2
- pulsar-timing-gravitational-wave-background: confirming paper 6, preprint 7
- rts-s-malaria-vaccine-first-approved: confirming statement 2, statement 3, paper 4, paper 5
- score-project-social-science-replicability: no confirming page; reactions: nature.com, sciencemediacentre.org expert-reaction-to-early-social-media-us, sciencemediacentre.org expert-reaction-to-study-assessing-early, sciencemediacentre.org expert-reaction-to-uk-government-announc
- semaglutide-obesity-step-1-trial-wegovy: confirming checker 5, checker 6, statement 7, paper 8, paper 10; reactions: sciencemediacentre.org
- sensitivity-conjecture-proved-huang: confirming paper 5, checker 6
- seshat-moralizing-gods-claim-and-dispute: confirming paper 4, paper 6
- six-microcredit-trials-find-modest-effects: confirming paper 7
- speech-neuroprostheses-stanford-ucsf-2023: confirming paper 8; reactions: sciencemediacentre.org expert-reaction-to-study-decoding-brain-, sciencemediacentre.org expert-reaction-to-study-describing-a-la
- sulawesi-oldest-narrative-cave-art-51200: confirming paper 3
- top-quark-entanglement-atlas-cms: confirming paper 4
- ultra-poor-graduation-trial-six-countries: confirming paper 4
- unit-distance-conjecture-disproved: confirming checker 3
- vesuvius-challenge-reads-herculaneum-scroll: confirming checker 2, statement 3, preprint 4
- willow-error-correction-below-threshold: confirming paper 3

## Pages that may contradict a candidate

A scan of every passage for retraction and failed-replication wording found these:

- **nudge-meta-analysis-publication-bias-dispute** (source 4, https://pmc.ncbi.nlm.nih.gov/articles/PMC9351501/): "Maier et al., Code and data for analyses in “No evidence for nudging after adjusting for publication bias.”"
- **nudge-meta-analysis-publication-bias-dispute** (source 6, https://pmc.ncbi.nlm.nih.gov/articles/PMC8740589/): "See "No evidence for nudging after adjusting for publication bias", e2200300119."
- **seshat-moralizing-gods-claim-and-dispute** (source 4, https://doi.org/10.1038/s41586-021-03656-3): "Retraction Note: Complex societies precede moralizing gods throughout world history."

Both candidates are already about a claim and its dispute. These pages support the dispute side, so they
do not contradict how the candidate is framed. For the Seshat candidate, though, the writers should note
that Nature retracted the paper.

## Hosts that refused the plain GET

| Host | Why (count) |
|---|---|
| fda.gov | 404 (4); pdf (4); 403 (1) |
| nature.com | pdf (2); 404 (1) |
| clinicaltrials.gov | 200 too little text (JS shell or empty) (3); unreadable (1) |
| science.org | 403 Cloudflare challenge (10) |
| journals.plos.org | pdf (2) |
| 2021-2025.state.gov | 200 too little text (JS shell or empty) (1) |
| eca.europa.eu | pdf (1) |
| pubmed.ncbi.nlm.nih.gov | 203 cookie wall (2) |
| facultyopinions.com | 403 (11) |
| cs.nyu.edu | pdf (1) |
| terrytao.wordpress.com | 200 too little text (JS shell or empty) (2) |
| dcs.warwick.ac.uk | pdf (1) |
| agupubs.onlinelibrary.wiley.com | 403 Cloudflare challenge (2) |
| breakthroughprize.org | 200 too little text (JS shell or empty) (1) |
| w3.jamstec.go.jp | ERR_TLS_CERT_ALTNAME_INVALID (1) |
| linkinghub.elsevier.com | 200 too little text (JS shell or empty) (4) |
| osf.io | 200 too little text (JS shell or empty) (4) |
| journals.sagepub.com | 403 Cloudflare challenge (1) |
| pnas.org | 403 Cloudflare challenge (2) |
| genome.ucsc.edu | 200 too little text (JS shell or empty) (1) |
| ncbi.nlm.nih.gov | 200 too little text (JS shell or empty) (1) |
| nber.org | pdf (1) |
| pubs.aeaweb.org | 403 Cloudflare challenge (3) |
| esa.int | 404 (1) |
| nih.gov | 403 Cloudflare challenge (1) |
| sciencemediacentre.org | 404 (2) |
| academic.oup.com | 403 Cloudflare challenge (2) |
| journals.ametsoc.org | 403 (1) |
| icpsr.umich.edu | 403 Cloudflare challenge (1) |
| api.openalex.org | unreadable (1) |
| mathunion.org | pdf (3) |
| nejm.org | 403 Cloudflare challenge (2) |
| degruyterbrill.com | 202 AWS WAF challenge (2) |
| jstor.org | 200 client challenge (JavaScript) (1) |
| people.mpim-bonn.mpg.de | 200 too little text (JS shell or empty) (1) |
| pubs.acs.org | 403 Cloudflare challenge (1) |
| onlinelibrary.wiley.com | 403 Cloudflare challenge (1) |
| doi.org | 404 (1) |
| physicsworld.com | 404 (2) |
| povertyactionlab.org | 404 (1) |

Facultyopinions.com (F1000) answers 403 to every review page (11). The rest repeat what K2 and K2b found:
- Cloudflare blocks Science, PNAS, NEJM, AEA, OUP and Wiley.
- Elsevier links stop at linkinghub.
- OSF and ClinicalTrials.gov pages are drawn by script.
- FDA's old press pages are gone.
