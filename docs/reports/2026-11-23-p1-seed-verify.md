# P1 seed configs: what P2 must verify

Written 2026-11-23 (Taipei) with the P1 pull request. P1 wrote the seed config files from memory, with no online check, because the build ran offline from a container. Strict JSON cannot carry a note, so this page is the one record of what is unverified. Every line below is a "Verify in P2" item of SPEC §4.11 or Appendix B. Lines marked UNSURE or UNKNOWN are the weakest: they may be wrong, and the twelve OpenAlex ids from S9999999901 to S9999999912 are placeholders that P2 must replace (none may remain after P2).

Each line reads: file, entry, what to check. Where a line says "spec", the value is the SPEC's own, not a recollection.

### fields.json

- fields.json | all seven openalex_fields lists and excluded [17, 22, 21] (26 ids, 11 to 36; spec) | compare each id and name with OpenAlex /fields.
- fields.json | 43 subfields (spec Appendix B, compared by script) | nothing online; ancient-texts is present for ancient_texts_ai.

### journals.json (22 entries)

For every line: GET /sources/<id>, compare display_name and issn_l with the entry (an id that merely resolves proves nothing), take the right id from /sources/issn:<issn> if it differs, then set in_pace from the yearly counts (SPEC 5.1). No S99999999NN placeholder may remain after P2.

- nature | S137773608 recalled, fairly sure | ISSN 0028-0836 | fields all seven
- science | S3880285 recalled, fairly sure | 0036-8075 | all seven
- cell | S110447773 recalled, fairly sure | 0092-8674 | biology
- pnas | S125754415 recalled, fairly sure | 0027-8424 | all seven
- prl | S24807848 recalled, fairly sure | 0031-9007 | physics
- nejm | S62468778 recalled, fairly sure | 0028-4793 | biology
- lancet | S49861241 recalled, fairly sure | 0140-6736 | biology
- nature-medicine | S203256638 UNSURE (about even odds) | 1078-8956 | biology
- aer | S23254222 UNSURE | 0002-8282 | social
- apsr | S176007004 UNSURE | 0003-0554 | social
- annals-of-mathematics | S9999999901 UNKNOWN placeholder | 0003-486X | mathematics
- nature-physics | S9999999902 UNKNOWN | 1745-2473 | physics
- nature-chemistry | S9999999903 UNKNOWN | 1755-4330 | chemistry
- nature-materials | S9999999904 UNKNOWN | 1476-1122 | chemistry only (could add physics)
- jacs | S9999999905 UNKNOWN | 0002-7863 | chemistry
- nature-biotechnology | S9999999906 UNKNOWN | 1087-0156 | biology
- nature-geoscience | S9999999907 UNKNOWN | 1752-0894 | earth
- nature-climate-change | S9999999908 UNKNOWN | 1758-678X | earth
- nature-human-behaviour | S9999999909 UNKNOWN | 2397-3374 | social | in_pace false (spec)
- inventiones | S9999999910 UNKNOWN | 0020-9910 | mathematics
- jams | S9999999911 UNKNOWN | 0894-0347 | mathematics
- acta-mathematica | S9999999912 UNKNOWN | 0001-5962 | mathematics
- journals.json | all 22 ISSNs | recalled; check digits valid by script; they are the ISSN-L as recalled: compare with OpenAlex issn_l.
- journals.json | fields per journal | the P1 assignment (the general journals Nature, Science, PNAS list all seven): confirm.
- journals.json | humanities | NO journal seeded: P2 picks 3 to 5 by OpenAlex citation share with a stated rule (SPEC 4.11); until then no in_pace journal is humanities alone.

### ai-terms.json

- ai-terms.json | all 20 phrases, in_pace true (spec) | P2's precision samples may set some false or add narrower phrases; check OpenAlex title_and_abstract.search takes the quoted phrases joined with OR.

### source-tiers.json, publishers (31)

For every line P2 checks (SPEC 4.11): hosts (and the host its doi.org URLs land on), article paths that admit papers from 2015 on, the type tag or label with its values for research, commentary and news (null if the GET from Kobol cannot read it), notice paths, and the newsroom host and path.

- nature | type_field citation_article_type and all types lists are guesses (UNSURE); paths /articles/s (spec) and /articles/nature (the spec's own nature14539 example); older ids of the sister journals (nphys, nchem, nmat, nm, nbt, ngeo, nclimate, ncomms) are NOT seeded; reaction_paths /articles/d41586- (spec): are all News & Views under it?
- science | type_field dc.type and types are guesses (UNSURE); paths /doi/10.1126/ (spec) plus /doi/full/10.1126/ and /doi/abs/10.1126/ (added by P1); deny /content/article/ (spec).
- cell-press | type_field citation_article_type and types guessed; 24 journal slugs as paths (cell, cell-reports, neuron, immunity, molecular-cell, current-biology, cell-metabolism, cell-stem-cell, cancer-cell, cell-systems, developmental-cell, cell-host-microbe, chem, joule, matter, med, patterns, structure, cell-chemical-biology, cell-genomics, cell-reports-medicine, cell-reports-physical-science, one-earth, iscience); a GET from Kobol may be blocked: then type_field null and drop reaction and its types.
- pnas | type_field dc.type and types guessed; paths /doi/10.1073/, /doi/full/10.1073/, /doi/abs/10.1073/.
- aps | journals.aps.org; 13 slugs as paths (prl, prx, prxquantum, prd, pre, prb, pra, prc, prresearch, prapplied, prfluids, prmaterials, rmp); no type tag seeded; link.aps.org should redirect to journals.aps.org.
- annals-of-mathematics | host annals.math.princeton.edu, any path.
- springer | link.springer.com /article/.
- sciencedirect | /science/article/ (GET probably blocked: keep type_field null).
- wiley | onlinelibrary.wiley.com /doi/.
- ams | ams.org /journals/.
- plos | journals.plos.org, any path.
- elife | /articles/ (reviewed preprints under another path are not seeded).
- nejm | /doi/.
- lancet | /journals/ and /doi/.
- acs | NOT in the SPEC list, added for JACS: pubs.acs.org /doi/.
- aea | NOT in the SPEC list, added for AER: aeaweb.org /articles and /journals/.
- project-euclid | NOT in the SPEC list, added because Acta Mathematica's current host is not known (maybe International Press): /journals/ and /euclid.
- cambridge-core | /core/journals/ (APSR).
- oxford-academic | academic.oup.com, any path.
- taylor-francis | /doi/.
- de-gruyter | degruyter.com and degruyterbrill.com (the newer host UNSURE), /document/.
- brill | /view/journals/ and /downloadpdf/journals/.
- sage | /doi/.
- project-muse | /article/ and /pub/.
- jstor | /stable/.
- arxiv | /abs/ (spec). biorxiv and medrxiv | /content/10.1101/ (spec): do 2026 preprints still use 10.1101? ssrn | the spec gives the host only: any path. osf-preprints | /preprints/ (spec). chemrxiv | the spec gives the host only: any path.

### source-tiers.json, other arrays

- resolvers.doi | hosts doi.org and dx.doi.org; path /10.; the kinds list is P1's.
- resolvers.pubmed | refused_pubtypes News, Newspaper Article, Editorial, Comment, Interview (spec); read the record page's type label (type_field is null).
- resolvers.pmc | pmc.ncbi.nlm.nih.gov /articles/ UNSURE (PMC's current host); refused_pubtypes news, editorial, article-commentary, interview are guessed JATS names: record PMC's real names.
- resolvers.pmc-legacy | www.ncbi.nlm.nih.gov /pmc/ (spec): does it still redirect?
- registries | clinicaltrials-gov /study/, rcsb /structure/, zenodo /records/ (spec); ebi (host from the spec; P1 added alphafold.ebi.ac.uk); github kinds dataset and proof and huggingface kind dataset (spec, both any path); lean-mathlib-docs (added by P1, kind proof, /mathlib4_docs/). The kinds of clinicaltrials-gov, rcsb, ebi and zenodo are P1's.
- deny_doi_prefixes | 10.1038/scientificamerican, 10.1021/cen-, 10.1063/pt., 10.1056/nejm-jw. all UNSURE: confirm against Crossref which prefixes only news uses; 10.1038/d41586- must stay out (spec).
- statement_suffixes | the spec's .edu .gov .int .europa.eu mpg.de cnrs.fr riken.jp sinica.edu.tw wycliffe.net unitedbiblesocieties.org sil.org vatican.va eurekalert.org/news-releases/: confirm each host is the body's own site. Added by P1, to confirm: the 22 expanded country suffixes and the 5 national forms; cern.ch, home.cern, embl.org, ethz.ch, nationalacademies.org, royalsociety.org; nobelprize.org, breakthroughprize.org, mathunion.org, abelprize.no, wolffund.org.il, kavliprize.org, laskerfoundation.org, scrollprize.org, scrollprize.substack.com; newsrooms (all UNSURE, P2 writes the real host and path per publisher): newsroom.wiley.com, group.springernature.com/gp/group/media/press-releases, elsevier.com/about/press-releases, cell.com/newsroom, aaas.org/news, elifesciences.org/for-the-press.
- reaction_sources | smc: hosts www.sciencemediacentre.org and sciencemediacentre.org, path /expert-reaction- (spec; the real path is unchecked); sister centres are not seeded (P2 lists them with paths); terence-tao: terrytao.wordpress.com (added by P1).
- press_hosts | 152 hosts, a policy list, nothing to verify except that none is also an allowlisted host (scripted: only the two intended exceptions).
- figure_hosts | spec: media.springernature.com, www.science.org, www.cell.com, www.pnas.org, arxiv.org, www.ncbi.nlm.nih.gov. Added by P1, UNSURE: pmc.ncbi.nlm.nih.gov, cdn.ncbi.nlm.nih.gov, www.biorxiv.org, www.medrxiv.org, iiif.elifesciences.org, journals.plos.org, cdn.rcsb.org. Check each against real figure image URLs and drop any that serves none.

### labs.json (all hosts and paths unchecked)

- google-deepmind | deepmind.google (sources.yaml uses deepmind.google/blog/rss.xml) and deepmind.com for older posts.
- openai | openai.com. anthropic | anthropic.com and www.anthropic.com, and claude.com UNSURE. futurehouse | futurehouse.org. isomorphic-labs | isomorphiclabs.com. sakana-ai | sakana.ai. arc-institute | arcinstitute.org. allen-institute-for-ai | allenai.org.
- meta-fair | ai.meta.com, paths /blog/ and /research/ UNSURE.
- microsoft-research-ai-for-science | microsoft.com, path /en-us/research/ UNSURE and wider than the lab (all Microsoft Research): narrow if a lab path exists.
- periodic-labs | periodic.com UNSURE. lila-sciences | lila.ai UNSURE.

### checkers.json

- erdosproblems | erdosproblems.com (sources.yaml uses www.). lean-mathlib-repo | github.com /leanprover-community/mathlib4. lean-mathlib-docs | leanprover-community.github.io /mathlib4_docs/ and /mathlib_stats.html (sources.yaml uses the stats page).
- nobel-prize nobelprize.org; breakthrough-prize breakthroughprize.org (its name must stay exactly Breakthrough Prize, hype-words refers to it); fields-medal mathunion.org; abel-prize abelprize.no; wolf-prize wolffund.org.il; kavli-prize kavliprize.org; lasker-awards laskerfoundation.org; casp predictioncenter.org: hosts only, paths any.
- vesuvius-challenge | scrollprize.org and scrollprize.substack.com (sources.yaml uses the Substack feed).
- fda | fda.gov and accessdata.fda.gov; ema | ema.europa.eu; taiwan-fda | fda.gov.tw and mcp.fda.gov.tw UNSURE; pmda | pmda.go.jp. All four have path any: narrow to approval records.
- clinicaltrials-gov-results | clinicaltrials.gov /study/, rung confirmed (spec).

### ai-drugs.json

- ai-drugs.json | drugs [] | add entries only where an AI basis can be quoted from the developer's or a paper's own words (Appendix B); an entry's approved.regulator must be fda, ema, taiwan-fda or pmda.

### counters.json

- erdos_ai | kind api is a guess ('api, else manual'): is there machine-readable data at erdosproblems.com or its GitHub data repository? source_url https://www.erdosproblems.com/.
- mathlib_theorems | https://leanprover-community.github.io/mathlib_stats.html (the URL in sources.yaml).
- ai_drugs | nothing beyond the ClinicalTrials.gov API v2 fields (SPEC 5.7).
- pdb_structures | which keyless record lists unreleased entries (SPEC 5.7 Verify); source_url https://www.rcsb.org/ is the home page.
- ai_retractions | source_url https://gitlab.com/crossref/retraction-watch-data (the repo behind the sources.yaml file URL).
- full_bibles | figures [] : P2's PR adds at least the two latest annual Wycliffe totals, each { as_of, total, source_url }; source_url https://www.wycliffe.net/resources/statistics/ UNSURE.
- ancient_texts_ai | kind ledger; source_url is the tracker's own findings folder on GitHub (added by P1).
- counters.json | every Chinese label and unit is P1's (Erdős kept in Latin script, Protein Data Bank kept in English as STYLE-ZH keeps names); JL may change them by PR.

### markers.json

- 2020-11-30 | https://predictioncenter.org/casp14/ UNSURE.
- 2022-11-30 | https://openai.com/index/chatgpt/ fairly sure.
- 2024-02-05 | https://scrollprize.org/grandprize UNSURE.
- 2024-10-09 | https://www.nobelprize.org/prizes/chemistry/2024/press-release/ fairly sure.
- markers.json | dates and English labels follow the spec; the Chinese labels are P1's.

### standing-stories.json

- standing-stories.json | stories [] (spec: empty at v1).
