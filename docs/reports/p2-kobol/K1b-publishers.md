# K1b: the primary-source allowlist against the live publishers (P2, on Kobol)

Checked on 2026-11-28, from about 13:20 to 13:55 Taipei (05:20 to 05:55 UTC), on Kobol. Every page was
fetched the way SPEC 4.14's snapshot step will:

- a plain GET, with the run's user agent;
- `Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.8` and `Accept-Language: en-US,en;q=0.9`;
- a 15 s timeout, at most 5 redirects (followed by hand), and the body cut at 3 MB;
- at most one request a second to any host;
- no login, cookies, CAPTCHA or workaround.

The DOIs came from Crossref (`works?filter=issn:` or `prefix:`, with `sample=3`), from the journal
feeds K1c captured, and from Nature's own News & Views and Comment lists. OpenAlex was not called. I fetched
141 pages through 372 requests, redirects included, and made 96 Crossref and NCBI requests. The page copies stay outside the repo, in `~/.unveiling/p2-scratch/k1b/pages/`.
`K1b-source-tiers-proposed.json` holds the full proposed object for every entry, each changed key with
its old and new value, and per page: the URL asked, the final URL, the status, whether it was readable,
and the type tags read. This report is the summary.

## The main finding: most publishers refuse the snapshot's GET

Of the 31 `publishers` entries, 10 serve a readable article page to a plain GET:

- Nature
- Springer
- APS
- AMS
- PLOS
- Cambridge Core
- Annals of Mathematics (its own site, older papers only)
- arXiv
- bioRxiv
- medRxiv

The other 21 refuse it.

| Refusal | Publishers |
|---|---|
| 403 from Cloudflare or a bot check | Science, PNAS, Wiley, NEJM, ACS, AEA, Oxford Academic, Taylor & Francis, SAGE, SSRN, ChemRxiv, Project Euclid and International Press (Acta Mathematica), Brill (CloudFront 403) |
| A "Client Challenge" page (200, JavaScript required) | eLife, JSTOR |
| An AWS WAF challenge (202) | De Gruyter Brill |
| A redirect to its `/verify` bot check | Project MUSE |
| A JavaScript shell with no content | OSF |
| Elsevier: a meta-refresh page, then 403 | Cell Press, ScienceDirect, The Lancet (below) |

For Elsevier, DOIs land on `linkinghub.elsevier.com/retrieve/pii/...`, a 200 page that moves on only by
a `<meta http-equiv="refresh">`, which the snapshot does not follow. The article pages behind it
(`www.cell.com`, `www.sciencedirect.com`, `www.thelancet.com`) answer 403.

PubMed's record pages now answer 203 with a cookie and JavaScript check. PMC's pages are readable.

This contradicts SPEC 4.11 in four places:

1. **Science, Cell Press and PNAS lose their type check.** Their entries set a `type_field` and the
   `reaction` kind. Their pages cannot be read, so by the spec's own rule ("where it does not, `type_field`
   is null") each becomes `type_field` null. They then keep no `types`, no `reaction` kind and no
   `reaction_paths`. That takes Science Perspectives, Cell Previews and PNAS Commentaries out of the
   reaction route. Two other ways are open:
   - **Recommended:** collect copies the type that these publishers' own feeds carry into the
     candidate's `types`. Science's feed has `dc:type` (Research Article, Perspective, In Depth,
     Editorial). Cell's and The Lancet's have `prism:section` (Article, Resource, Preview, Correction;
     Comment, World Report, Editorial). PRL's has `dc:type`. Then a pack candidate keeps a typed kind
     with no page fetch.
   - Accept the loss.
2. **A cited `doi.org` URL for an Elsevier journal lands on `linkinghub.elsevier.com`,** which no entry
   lists. I propose an `elsevier-linkinghub` entry, kinds `paper` and `notice`, path `/retrieve/pii/`,
   `type_field` null. Its path covers The Lancet's news (World Report, Editorial) as well as research, so
   the URL alone cannot keep them out. The other way is for the snapshot to follow a meta refresh once.
3. **Cited PMC pages always fail the type check.** A PMC page shows no article type, and the spec says
   a PMC URL passes only when the evidence shows its types. E-utilities give the type:
   - **PMC:** `efetch.fcgi?db=pmc&id=<n>` returns `<article article-type="research-article">`.
   - **PubMed:** `esummary.fcgi?db=pubmed` returns `pubtype`.

   I propose that the snapshot step read a cited PubMed or PMC URL's types there, within NCBI's 3 a
   second.
4. **Quotes and numbers from blocked publishers need an open copy.** NUMBER_SOURCED and the quote
   checks read a page's fetched text, so a blocked publisher's numbers need one. Per publisher:

   | Open copy | Publishers |
   |---|---|
   | PMC | PNAS (every paper after 6 months), eLife (every paper, plus its bioRxiv preprint), Cell Press, NEJM, The Lancet, Wiley, OUP, SAGE (many papers), Science (author manuscripts) |
   | The arXiv preprint | Annals and Acta (Project Euclid, International Press) |
   | The NBER or author working paper | AEA |
   | None general | De Gruyter, Brill, MUSE, JSTOR, ChemRxiv (blocked itself), SSRN (itself the preprint) |

   `api.osf.io` would be OSF's readable copy. The whole list is in the JSON's `open_copies`.

## Per publisher

The "Proposed" column gives only the changes. The full objects are in the JSON.

| Publisher | Sample URLs (DOI to landing) | Result | Proposed |
|---|---|---|---|
| nature | `10.1038/nature14539` to `/articles/nature14539`; `nature16961`; `nphys3255`; `nm.4053`; `ncomms10235`; `srep10000`; `530419c`; `nature.2016.19411`; `d41586-026-03491-4` (News & Views); `d41586-026-03723-7` (Comment); `nature25779` (notice) | Readable. The current type tag `citation_article_type` says "Article" for research, reviews and correspondence alike (`530419c` is a 2016 Correspondence). `dc.type` separates them: OriginalPaper, ReviewPaper, BriefCommunication; Letter (correspondence); News, Research Highlight, Book Review, Podcast, Futures; News And Views, Comment; Erratum | `type_field` `dc.type`. `paths` `/articles/s`, `/articles/n` (every old `nature`, `nphys`, `nm.`, `ncomms`... id), `/articles/srep`. `deny_paths` `/articles/nature.2` (old news ids such as `nature.2016.19411`). `types`: paper OriginalPaper, ReviewPaper, BriefCommunication, Analysis; notice Erratum, Correction, Retraction, Retraction Note, Addendum, (Editorial) Expression of Concern; reaction News And Views, Comment. All 24 current News & Views and Comment pieces sampled are under `/articles/d41586-`. Pre-2017 News & Views use volume-number ids (`/articles/540345a`) typed BriefCommunication, so they stay unlisted |
| science | `10.1126/science.adx9551`, `.aek0041` (Perspective), `.aeo3726` (In Depth), `.aeo0595` (Editorial), `.aba6100` (notice); 2015 DOIs go to `www.sciencemag.org/lookup/doi/...` | 403 on every page | `type_field` null, kinds `paper`, `notice` (no `reaction`). `hosts` add `www.sciencemag.org`, `science.sciencemag.org`. `paths` add `/lookup/doi/10.1126/`. Or keep typing from the feed (point 1) |
| cell-press | `10.1016/j.cell.2016.10.051`, `.2024.10.023`, Preview, Correction, all to `linkinghub.elsevier.com/retrieve/pii/S0092...` | Meta-refresh page, then 403 | `type_field` null, no `reaction`; plus the new `elsevier-linkinghub` entry |
| pnas | `10.1073/pnas.1704105114` to `pnas.org/doi/full/...` | 403 | `type_field` null, no `reaction` |
| aps | `10.1103/physrevlett.117.067001` via `link.aps.org` to `journals.aps.org/prl/abstract/...` | Readable; no type in the page | `hosts` add `link.aps.org`. A new optional entry `aps-physics`: `physics.aps.org`, `reaction_paths` `/articles/`, `type_field` `.article-type`, reaction Viewpoint (Synopsis and Focus are news) |
| annals-of-mathematics | `10.4007/annals.2017.186.2.6` to `annals.math.princeton.edu/2017/186-2/p06`; 2023 and 2026 DOIs to `projecteuclid.org/journals/annals-of-mathematics/...` | Old: readable, no type. New: bot page | No change; project-euclid covers the new host |
| springer | `10.1007/s11051-025-06435-7` to `link.springer.com/article/...`; notice `s12517-021-09212-7` | Readable. `dc.type` OriginalPaper; a retraction note is `dc.type` Erratum, `citation_article_type` "Retraction Note". One `10.1007` DOI landed on `www.springermedizin.de` (a medical portal) | `type_field` `dc.type`. paper OriginalPaper, ReviewPaper, BriefCommunication; notice Erratum, Correction, Retraction, Retraction Note, Addendum, Expression of Concern |
| sciencedirect | `10.1016/j.jcp.2016.10.068` to linkinghub | Blocked | Covered by `elsevier-linkinghub` |
| wiley | `10.1002/rnc.3820`; a Cochrane DOI via `doi.wiley.com` | 403 | None |
| ams | `10.1090/mcom/3084` via `www.ams.org` to `pubs.ams.org/journals/...` | Readable; no type | `hosts` add `pubs.ams.org` |
| plos | `10.1371/journal.pntd.0006099` via `dx.plos.org` to `journals.plos.org/.../article?id=...` | Readable. `citation_article_type`: Research Article; Retraction | `type_field` `citation_article_type`. paper Research Article; notice Retraction, Correction, Expression of Concern |
| elife | `10.7554/elife.25783` to `elifesciences.org/articles/25783` | Client Challenge | None |
| nejm | `10.1056/nejmoa1410689`, `nejmp2611049` (Perspective) | 403 | None |
| lancet | `10.1016/s0140-6736(17)32282-1`, Comment, World Report, Editorial, all to linkinghub | Blocked; `thelancet.com` redirects to a login callback | Covered by `elsevier-linkinghub` |
| acs | `10.1021/jacs.5b04403` to `pubs.acs.org/doi/...` | 403 Cloudflare challenge | None |
| aea | `10.1257/aer.20231087` to `pubs.aeaweb.org/doi/...` | 403 | `hosts` add `pubs.aeaweb.org`, `paths` add `/doi/` (the landing host was not listed) |
| project-euclid | `10.4310/sdg.2017.v22.n1.a9` (International Press, Acta's publisher) to `link.intlpress.com/JDetail/...` | 403 | `hosts` add `link.intlpress.com`, `paths` add `/JDetail/` |
| cambridge-core | `10.1017/jmo.2015.33` to `www.cambridge.org/core/journals/...` | Readable; no type tag or label | None (`type_field` stays null) |
| oxford-academic | `10.1093/fmls/cqx035` | 403 | None |
| taylor-francis | `10.1080/09592318.2026.2704772`; one older `10.1080` DOI lands on `academic.oup.com` | 403 | None |
| de-gruyter | `10.1515/jjzg-2016-0028` via `www.degruyter.com` to `www.degruyterbrill.com/document/doi/.../html` | 202 AWS WAF challenge | None (hosts already listed) |
| brill | `10.1163/15700666-12340106` to `brill.com/view/journals/...` | 403 CloudFront | None |
| sage | `10.1177/1032373216668183` | 403 | None |
| project-muse | `10.1353/jqr.2016.0024` to `muse.jhu.edu/verify` | A bot check: the landing is `/verify`, which no path admits, so every MUSE `doi.org` URL fails the type check | None in config. Cite `muse.jhu.edu/article/` URLs directly, or an open copy |
| jstor | `10.2307/48857613` to `www.jstor.org/stable/...`; `10.2307/26371653` to `scholarlypublishingcollective.org` | Client Challenge; 403 | Optional: a `scholarlypublishingcollective.org` entry, paper and notice, path `/` |
| arxiv | `arxiv.org/abs/2611.34933`; `10.48550/arXiv.2611.34933` to `/abs/` | Readable | None |
| biorxiv | `10.64898/2026.07.23.740341` to `www.biorxiv.org/content/10.64898/...v1`; `10.1101/2020.03.22.002386` to `/content/10.1101/...` | Readable | `paths` add `/content/10.64898/` |
| medrxiv | `10.64898/2026.07.20.26354798`, `10.1101/2020.02.20.20025841` | Readable | `paths` add `/content/10.64898/` |
| ssrn | `10.2139/ssrn.5184785` via `www.ssrn.com` to `papers.ssrn.com/sol3/papers.cfm` | 403 "Content Blocked" | None |
| osf-preprints | `10.31219/osf.io/b3ge7_v2` to `osf.io/b3ge7_v2` | A JavaScript shell. The landing has no `/preprints/` prefix, so every OSF DOI fails the URL test | `paths` `/` (broad; the other way is to drop OSF) |
| chemrxiv | `10.26434/chemrxiv-2025-cg32t` to `chemrxiv.org/doi/full/...` | 403 | None |

## Resolvers

- **`doi`:** no change.
- **PubMed:**
  - **Pages:** `pubmed.ncbi.nlm.nih.gov/<pmid>/` answers 203 with a cookie and JavaScript check, so
    `type_field` stays null.
  - **Types:** esummary's `pubtype` gives the type (`["Journal Article"]` for the Nature record
    sampled).
  - **`refused_pubtypes`:** "News, Newspaper Article, Editorial, Comment, Interview" are PubMed's own
    publication-type names. Keep them.
- **PMC:**
  - **Address:** `pmc.ncbi.nlm.nih.gov/articles/PMC<n>/` is the current address. The older
    `www.ncbi.nlm.nih.gov/pmc/articles/PMC<n>/` answers 301 to it. Both entries stay.
  - **Types:** the page shows no type, and `efetch db=pmc` gives the JATS `article-type` (point 3).
  - **`refused_pubtypes`:** JATS names are lower case with hyphens: research-article, review-article,
    brief-report, case-report, letter, editorial, news, article-commentary, interview, book-review,
    correction, retraction, expression-of-concern. The seed list (news, editorial, article-commentary,
    interview) is right. book-review could be added.

## `deny_doi_prefixes`

- **`10.1038/scientificamerican`:** confirmed. 40 of 40 Scientific American works sampled carry it.
- **`10.1021/cen-`:** confirmed (`10.1021/cen-v088n039.p050` and the like). Crossref writes the title
  as "Chemical &amp; Engineering News".
- **`10.1063/pt.`:** confirmed for Physics Today from about 2017 (`10.1063/pt.3.5157`,
  `10.1063/pt.jnrr.hqgg`). Its older items use `10.1063/1.NNNN`, which AIP's research journals share,
  so they cannot be listed.
- **`10.1056/nejm-jw.`:** not confirmed. Crossref finds no NEJM Journal Watch work under `10.1056`, so
  drop it.
- **New: `10.1038/nature.20`.** These are Nature's old news DOIs, `nature.2015.NNNNN` to
  `nature.2019.NNNNN`; `10.1038/nature.2016.19411` is `dc.type` News. No research DOI has a dot after
  "nature".
- **`10.1038/d41586-`:** confirmed not news-only. News And Views and Comment pages share it.

## Registries

- **GitHub:** `github.com` repository pages are records. `docs.github.com` (documentation, readable)
  holds none. `gist.github.com`, `api.github.com` and `codeload.github.com` are already refused by
  `BLOCKED_HOSTS`. `*.github.io` is a separate domain (mathlib's docs have their own entry).
- **Hugging Face:** `huggingface.co/datasets/<org>/<name>` (and models, `/<org>/<model>`, and
  `/spaces/`) are records. `discuss.huggingface.co` (the forum), `huggingface.co/docs` and
  `huggingface.co/blog` are not.
- **Proposed:** add `deny_hosts` (or an exact-host form) to registry entries, with
  `docs.github.com` and `discuss.huggingface.co`, and `deny_paths` `/docs`, `/blog`, `/learn`, `/posts`
  and `/papers` on huggingface.co. That needs its test and a SPEC 0.4 row, as SPEC 4.11 says.
- **A false alarm:** both sites' scripts contain the word "captcha", but the pages are real (17 to 42 KB
  of text).

## `figure_hosts`

| Host | Status | Where it was seen |
|---|---|---|
| media.springernature.com | Seeded, seen | Nature research, Scientific Reports, Springer |
| media.nature.com | **New** | Nature Comment |
| cdn.journals.aps.org | **New** | APS journals |
| physics.aps.org | **New** | Physics Viewpoints |
| journals.plos.org | Seeded, seen | PLOS |
| static.cambridge.org | **New** | Cambridge Core |
| cdn.ncbi.nlm.nih.gov | Seeded, seen | PMC figures |
| www.biorxiv.org | Seeded, seen | bioRxiv full text, `.full` |
| cdn.rcsb.org | Seeded, seen | RCSB structure pages, which also use `files.rcsb.org` |
| www.science.org, www.cell.com, www.pnas.org, iiif.elifesciences.org | Seeded, not checkable | The publisher blocks the page |
| arxiv.org | Seeded, not seen | Abstract pages have no figures, and the sampled paper's HTML version had none |
| www.medrxiv.org | Seeded, not checked | No full-text page fetched |
| pmc.ncbi.nlm.nih.gov | Seeded, serves none | It is PMC's page host; its figures are on cdn.ncbi.nlm.nih.gov |
| www.ncbi.nlm.nih.gov | Seeded, serves none | Drop it: PMC moved, and the old page redirects |

## Not finished

- **Expression-of-concern type values.** No sampled notice page showed one, so the values listed are
  the seed's.
- **Nature's Analysis.** Its `dc.type` is unconfirmed.
- **PLOS commentary types.** PLOS Biology's Perspective and Primer were not sampled.
- **Science, Cell, PNAS, eLife and NEJM type names.** These could not be read from their pages at all.
- **Statement suffixes and reaction sources.** These are left for K1d.
