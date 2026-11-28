# Sources: terms, limits and credit lines

This file records, for each feed of `config/sources.yaml`, where it is read, what its host says about request limits and reuse, and the line that credits it. K1c and K1d
read every host on Kobol on 2026-11-28 (`docs/reports/p2-kobol/`); a later `sources:check` may move a limit, and a change here goes in the PR that makes it.

**How the credit lines are used.** `/about` shows each `Credit:` line of this file (SPEC §6), and `/zh/about` shows the `Credit (zh):` line that follows it. So a read feed has
exactly two credit lines, the English one and then, on the next line, the Chinese one, each a single line with no break inside it. A host whose terms fix the wording keeps it as
given, and the Chinese follows it. A feed that is not read gets a note and no credit lines. No line holds an em dash or an en dash (`NO_EM_DASH`, SPEC §4.12), and the Chinese is Traditional
Chinese as written in Taiwan (SPEC §4.11, `terms-zh.json`). `tests/sources-doc.test.ts` checks the shape: every feed id has a section, every `Credit:` line is followed by a
`Credit (zh):` line, and no credit line is empty.

## Feeds

### `arxiv-math`

- **What:** arXiv API, mathematics: math*, cs.IT and math-ph (each announcement's new submissions).
- **Read at:** `https://export.arxiv.org/api/query`; fallback `https://rss.arxiv.org/atom/math`.
- **Limits:** One request every 3 seconds and one connection at a time, for all machines together (arXiv API terms of use, read 2026-11-28). The terms do not say whether `rss.arxiv.org` shares the allowance, so the queue treats the two hosts as one (SPEC §4.13).
- **Terms:** Descriptive metadata are CC0 1.0. E-prints stay with their authors. The terms fix no credit wording: they encourage a link to the abstract page and forbid implying that arXiv endorses the project, which the line follows.

Credit: Preprint metadata from arXiv (arxiv.org), CC0 1.0; each link goes to the paper on arXiv.
Credit (zh): 預印本詮釋資料來自 arXiv（arxiv.org），採 CC0 1.0；各連結指向 arXiv 上的論文。

### `arxiv-physics`

- **What:** arXiv API, physics: physics*, hep*, gr-qc and nucl*.
- **Read at:** `https://export.arxiv.org/api/query`; fallback `https://rss.arxiv.org/atom/physics`.
- **Limits:** One request every 3 seconds and one connection at a time, for all machines together (arXiv API terms of use, read 2026-11-28). The terms do not say whether `rss.arxiv.org` shares the allowance, so the queue treats the two hosts as one (SPEC §4.13).
- **Terms:** Descriptive metadata are CC0 1.0. E-prints stay with their authors. The terms fix no credit wording: they encourage a link to the abstract page and forbid implying that arXiv endorses the project, which the line follows.

Credit: Preprint metadata from arXiv (arxiv.org), CC0 1.0; each link goes to the paper on arXiv.
Credit (zh): 預印本詮釋資料來自 arXiv（arxiv.org），採 CC0 1.0；各連結指向 arXiv 上的論文。

### `arxiv-astro-ph`

- **What:** arXiv API, astrophysics: astro-ph*.
- **Read at:** `https://export.arxiv.org/api/query`; fallback `https://rss.arxiv.org/atom/astro-ph`.
- **Limits:** One request every 3 seconds and one connection at a time, for all machines together (arXiv API terms of use, read 2026-11-28). The terms do not say whether `rss.arxiv.org` shares the allowance, so the queue treats the two hosts as one (SPEC §4.13).
- **Terms:** Descriptive metadata are CC0 1.0. E-prints stay with their authors. The terms fix no credit wording: they encourage a link to the abstract page and forbid implying that arXiv endorses the project, which the line follows.

Credit: Preprint metadata from arXiv (arxiv.org), CC0 1.0; each link goes to the paper on arXiv.
Credit (zh): 預印本詮釋資料來自 arXiv（arxiv.org），採 CC0 1.0；各連結指向 arXiv 上的論文。

### `arxiv-cond-mat`

- **What:** arXiv API, condensed matter: cond-mat*.
- **Read at:** `https://export.arxiv.org/api/query`; fallback `https://rss.arxiv.org/atom/cond-mat`.
- **Limits:** One request every 3 seconds and one connection at a time, for all machines together (arXiv API terms of use, read 2026-11-28). The terms do not say whether `rss.arxiv.org` shares the allowance, so the queue treats the two hosts as one (SPEC §4.13).
- **Terms:** Descriptive metadata are CC0 1.0. E-prints stay with their authors. The terms fix no credit wording: they encourage a link to the abstract page and forbid implying that arXiv endorses the project, which the line follows.

Credit: Preprint metadata from arXiv (arxiv.org), CC0 1.0; each link goes to the paper on arXiv.
Credit (zh): 預印本詮釋資料來自 arXiv（arxiv.org），採 CC0 1.0；各連結指向 arXiv 上的論文。

### `arxiv-quant-ph`

- **What:** arXiv API, quantum physics: quant-ph.
- **Read at:** `https://export.arxiv.org/api/query`; fallback `https://rss.arxiv.org/atom/quant-ph`.
- **Limits:** One request every 3 seconds and one connection at a time, for all machines together (arXiv API terms of use, read 2026-11-28). The terms do not say whether `rss.arxiv.org` shares the allowance, so the queue treats the two hosts as one (SPEC §4.13).
- **Terms:** Descriptive metadata are CC0 1.0. E-prints stay with their authors. The terms fix no credit wording: they encourage a link to the abstract page and forbid implying that arXiv endorses the project, which the line follows.

Credit: Preprint metadata from arXiv (arxiv.org), CC0 1.0; each link goes to the paper on arXiv.
Credit (zh): 預印本詮釋資料來自 arXiv（arxiv.org），採 CC0 1.0；各連結指向 arXiv 上的論文。

### `arxiv-q-bio`

- **What:** arXiv API, quantitative biology: q-bio*.
- **Read at:** `https://export.arxiv.org/api/query`; fallback `https://rss.arxiv.org/atom/q-bio`.
- **Limits:** One request every 3 seconds and one connection at a time, for all machines together (arXiv API terms of use, read 2026-11-28). The terms do not say whether `rss.arxiv.org` shares the allowance, so the queue treats the two hosts as one (SPEC §4.13).
- **Terms:** Descriptive metadata are CC0 1.0. E-prints stay with their authors. The terms fix no credit wording: they encourage a link to the abstract page and forbid implying that arXiv endorses the project, which the line follows.

Credit: Preprint metadata from arXiv (arxiv.org), CC0 1.0; each link goes to the paper on arXiv.
Credit (zh): 預印本詮釋資料來自 arXiv（arxiv.org），採 CC0 1.0；各連結指向 arXiv 上的論文。

### `arxiv-physics-chem-ph`

- **What:** arXiv API, chemical physics: physics.chem-ph.
- **Read at:** `https://export.arxiv.org/api/query`; fallback `https://rss.arxiv.org/atom/physics.chem-ph`.
- **Limits:** One request every 3 seconds and one connection at a time, for all machines together (arXiv API terms of use, read 2026-11-28). The terms do not say whether `rss.arxiv.org` shares the allowance, so the queue treats the two hosts as one (SPEC §4.13).
- **Terms:** Descriptive metadata are CC0 1.0. E-prints stay with their authors. The terms fix no credit wording: they encourage a link to the abstract page and forbid implying that arXiv endorses the project, which the line follows.

Credit: Preprint metadata from arXiv (arxiv.org), CC0 1.0; each link goes to the paper on arXiv.
Credit (zh): 預印本詮釋資料來自 arXiv（arxiv.org），採 CC0 1.0；各連結指向 arXiv 上的論文。

### `arxiv-stat-ml`

- **What:** arXiv API, statistics and machine learning papers cross-listed to a science category: stat.ML.
- **Read at:** `https://export.arxiv.org/api/query`; fallback `https://rss.arxiv.org/atom/stat.ML`.
- **Limits:** One request every 3 seconds and one connection at a time, for all machines together (arXiv API terms of use, read 2026-11-28). The terms do not say whether `rss.arxiv.org` shares the allowance, so the queue treats the two hosts as one (SPEC §4.13).
- **Terms:** Descriptive metadata are CC0 1.0. E-prints stay with their authors. The terms fix no credit wording: they encourage a link to the abstract page and forbid implying that arXiv endorses the project, which the line follows.

Credit: Preprint metadata from arXiv (arxiv.org), CC0 1.0; each link goes to the paper on arXiv.
Credit (zh): 預印本詮釋資料來自 arXiv（arxiv.org），採 CC0 1.0；各連結指向 arXiv 上的論文。

### `biorxiv`

- **What:** bioRxiv API, new preprints in the window (30 a page; DOIs 10.1101 and 10.64898).
- **Read at:** `https://api.biorxiv.org/details/biorxiv`.
- **Limits:** No limit stated; the API pages 30 items at a time by cursor.
- **Terms:** Each preprint carries its own licence in the API's `license` field. The tracker prints metadata and links, and quotes are limited by SPEC §4.3.

Credit: Preprint metadata from the bioRxiv and medRxiv API (Cold Spring Harbor Laboratory).
Credit (zh): 預印本詮釋資料來自 bioRxiv 與 medRxiv API（冷泉港實驗室）。

### `medrxiv`

- **What:** medRxiv API, new preprints in the window (30 a page; DOIs 10.1101 and 10.64898).
- **Read at:** `https://api.biorxiv.org/details/medrxiv`.
- **Limits:** No limit stated; the API pages 30 items at a time by cursor.
- **Terms:** Each preprint carries its own licence in the API's `license` field. The tracker prints metadata and links, and quotes are limited by SPEC §4.3.

Credit: Preprint metadata from the bioRxiv and medRxiv API (Cold Spring Harbor Laboratory).
Credit (zh): 預印本詮釋資料來自 bioRxiv 與 medRxiv API（冷泉港實驗室）。

### `pubmed`

- **What:** PubMed E-utilities (esearch, then esummary titles and efetch abstracts, 200 PMIDs a request) on the AI terms.
- **Read at:** `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi`.
- **Limits:** At most 3 requests a second without a key (response header `x-ratelimit-limit: 3`); no key is used.
- **Terms:** NLM data: NLM asks that PubMed data be credited to the NLM. It fixes no wording that K1c found on the E-utilities page, so the line is the project's.

Credit: Records from PubMed, courtesy of the U.S. National Library of Medicine.
Credit (zh): 書目資料來自 PubMed，由美國國家醫學圖書館提供。

### `crossref-journals`

- **What:** Crossref works, the leading journals' new articles (config/journals.json).
- **Read at:** `https://api.crossref.org/works`.
- **Limits:** 5 requests a second and 1 at a time in the public pool (response headers `x-rate-limit-limit: 5`, `x-rate-limit-interval: 1s`, `x-concurrency-limit: 1`); no `mailto` is sent, so the client stays in that pool.
- **Terms:** Crossref metadata is open and its facts are CC0. No credit wording is required.

Credit: Metadata from Crossref.
Credit (zh): 詮釋資料來自 Crossref。

### `journal-nature`

- **What:** Nature, latest research.
- **Read at:** `https://www.nature.com/nature.rss`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of Springer Nature; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自 Springer Nature 的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-science`

- **What:** Science, current issue.
- **Read at:** `https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of AAAS; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自美國科學促進會（AAAS）的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-cell`

- **What:** Cell, in press.
- **Read at:** `https://www.cell.com/cell/inpress.rss`; fallback `https://www.cell.com/cell/current.rss`.
- **Limits:** No limit stated; one request a morning (a second for the fallback address).
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of Cell Press (Elsevier); each article belongs to its publisher.
Credit (zh): 論文標題與連結取自 Cell Press（Elsevier）的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-pnas`

- **What:** PNAS, current issue.
- **Read at:** `https://www.pnas.org/action/showFeed?type=etoc&feed=rss&jc=pnas`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of PNAS; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自美國國家科學院院刊（PNAS）的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-prl`

- **What:** Physical Review Letters, recent papers.
- **Read at:** `https://feeds.aps.org/rss/recent/prl.xml`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of the American Physical Society; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自美國物理學會的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-annals-of-mathematics`

- **What:** Annals of Mathematics, accepted papers.
- **Read at:** `https://annals.math.princeton.edu/feed`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of Annals of Mathematics (Princeton); each article belongs to its publisher.
Credit (zh): 論文標題與連結取自 Annals of Mathematics（普林斯頓）的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-nature-physics`

- **What:** Nature Physics, latest research.
- **Read at:** `https://www.nature.com/nphys.rss`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of Springer Nature; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自 Springer Nature 的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-nature-chemistry`

- **What:** Nature Chemistry, latest research.
- **Read at:** `https://www.nature.com/nchem.rss`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of Springer Nature; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自 Springer Nature 的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-nature-materials`

- **What:** Nature Materials, latest research.
- **Read at:** `https://www.nature.com/nmat.rss`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of Springer Nature; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自 Springer Nature 的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-nature-medicine`

- **What:** Nature Medicine, latest research.
- **Read at:** `https://www.nature.com/nm.rss`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of Springer Nature; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自 Springer Nature 的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-nejm`

- **What:** NEJM, current issue.
- **Read at:** `https://www.nejm.org/action/showFeed?jc=nejm&type=etoc&feed=rss`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of the Massachusetts Medical Society; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自 Massachusetts Medical Society 的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-lancet`

- **What:** The Lancet, current issue.
- **Read at:** `https://www.thelancet.com/rssfeed/lancet_current.xml`; fallback `https://www.thelancet.com/rssfeed/lancet_online.xml`.
- **Limits:** No limit stated; one request a morning (a second for the fallback address).
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of The Lancet (Elsevier); each article belongs to its publisher.
Credit (zh): 論文標題與連結取自 The Lancet（Elsevier）的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-nature-biotechnology`

- **What:** Nature Biotechnology, latest research.
- **Read at:** `https://www.nature.com/nbt.rss`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of Springer Nature; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自 Springer Nature 的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-nature-geoscience`

- **What:** Nature Geoscience, latest research.
- **Read at:** `https://www.nature.com/ngeo.rss`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of Springer Nature; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自 Springer Nature 的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-nature-climate-change`

- **What:** Nature Climate Change, latest research.
- **Read at:** `https://www.nature.com/nclimate.rss`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of Springer Nature; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自 Springer Nature 的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-aer`

- **What:** American Economic Review, current issue.
- **Read at:** `https://pubs.aeaweb.org/action/showFeed?type=etoc&feed=rss&jc=aer`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of the American Economic Association; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自美國經濟學會的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-apsr`

- **What:** American Political Science Review, recent articles.
- **Read at:** `https://www.cambridge.org/core/rss/product/id/833A7242AC7B607BA7F6168DA072DB3B`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of Cambridge University Press; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自劍橋大學出版社的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-nature-human-behaviour`

- **What:** Nature Human Behaviour, latest research.
- **Read at:** `https://www.nature.com/nathumbehav.rss`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of Springer Nature; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自 Springer Nature 的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-inventiones`

- **What:** Inventiones mathematicae, recent articles.
- **Read at:** `https://link.springer.com/search.rss?facet-content-type=Article&facet-journal-id=222&channel-name=Inventiones%20mathematicae`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of Springer; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自 Springer 的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-jams`

- **What:** Journal of the AMS, current issue.
- **Read at:** `https://www.ams.org/rss/jams.rss`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of the American Mathematical Society; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自美國數學學會的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-grl`

- **What:** Geophysical Research Letters, most recent.
- **Read at:** `https://agupubs.onlinelibrary.wiley.com/feed/19448007/most-recent`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of AGU (Wiley); each article belongs to its publisher.
Credit (zh): 論文標題與連結取自美國地球物理聯合會（AGU，Wiley）的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-jgr-atmospheres`

- **What:** Journal of Geophysical Research: Atmospheres, most recent.
- **Read at:** `https://agupubs.onlinelibrary.wiley.com/feed/21698996/most-recent`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of AGU (Wiley); each article belongs to its publisher.
Credit (zh): 論文標題與連結取自美國地球物理聯合會（AGU，Wiley）的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-language`

- **What:** Language, latest articles (Project MUSE).
- **Read at:** `https://muse.jhu.edu/feeds/latest_articles?jid=112`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of Project MUSE (for the Linguistic Society of America); each article belongs to its publisher.
Credit (zh): 論文標題與連結取自 Project MUSE（為美國語言學會發行）的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-antiquity`

- **What:** Antiquity, recent articles.
- **Read at:** `https://www.cambridge.org/core/rss/product/id/C06207AB2CE3EE948718B5F6E30870D7`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of Cambridge University Press; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自劍橋大學出版社的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-classical-quarterly`

- **What:** The Classical Quarterly, recent articles.
- **Read at:** `https://www.cambridge.org/core/rss/product/id/98B56E98F6176CC085C2D10BEF5DA258`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep copyright with the publisher. The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of Cambridge University Press; each article belongs to its publisher.
Credit (zh): 論文標題與連結取自劍橋大學出版社的 RSS 訂閱；各篇論文權利屬其出版者。

### `journal-hts`

- **What:** HTS Teologiese Studies / Theological Studies, recent articles.
- **Read at:** `https://hts.org.za/index.php/hts/gateway/plugin/WebFeedGatewayPlugin/rss2`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** Each item is CC BY 4.0 (AOSIS). The tracker prints titles and links only.

Credit: Article titles and links from the RSS feed of AOSIS (open access, CC BY 4.0 for each item); each article belongs to its publisher.
Credit (zh): 論文標題與連結取自 AOSIS（開放取用，各篇採 CC BY 4.0）的 RSS 訂閱；各篇論文權利屬其出版者。

### `eurekalert`

- **What:** EurekAlert! news releases, the browse page (institutions' own releases; 12 a page).
- **Read at:** `https://www.eurekalert.org/news-releases/browse`.
- **Limits:** No limit stated.
- **Terms:** EurekAlert! terms of service: each release belongs to the institution that posted it, and the tracker cites it as that institution's own statement.

Credit: News releases posted on EurekAlert! by AAAS; each release belongs to its institution.
Credit (zh): 新聞稿取自 AAAS 經營的 EurekAlert!，各稿權利屬發布機構。

### `lab-deepmind`

- **What:** Google DeepMind's own blog.
- **Read at:** `https://deepmind.google/blog/rss.xml`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep the posts with the lab. The tracker prints titles and links only.

Credit: Posts from Google DeepMind's own site.
Credit (zh): 文章取自 Google DeepMind 官方網站。

### `lab-openai`

- **What:** OpenAI's news feed (all of its news, product posts included).
- **Read at:** `https://openai.com/news/rss.xml`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep the posts with the lab. The tracker prints titles and links only.

Credit: Posts from OpenAI's own site.
Credit (zh): 文章取自 OpenAI 官方網站。

### `lab-anthropic`

- **What:** Anthropic's research page (no feed; the news page is the fallback).
- **Read at:** `https://www.anthropic.com/research`; fallback `https://www.anthropic.com/news`.
- **Limits:** No limit stated; one request a morning (a second for the fallback address).
- **Terms:** The site's terms keep the posts with the lab. The tracker prints titles and links only.

Credit: Posts from Anthropic's own site.
Credit (zh): 文章取自 Anthropic 官方網站。

### `lab-meta-fair`

- **What:** Meta FAIR's blog page (no feed; client-rendered, so a plain read may show older posts).
- **Read at:** `https://ai.meta.com/blog/`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep the posts with the lab. The tracker prints titles and links only.

Credit: Posts from Meta's own site.
Credit (zh): 文章取自 Meta 官方網站。

### `lab-microsoft-ai-for-science`

- **What:** Microsoft Research's site-wide feed (the AI for Science lab's own feed has had no item since 2025-06-18).
- **Read at:** `https://www.microsoft.com/en-us/research/feed/`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep the posts with the lab. The tracker prints titles and links only.

Credit: Posts from Microsoft Research's own site.
Credit (zh): 文章取自 Microsoft Research 官方網站。

### `lab-futurehouse`

- **What:** FutureHouse's research page (no feed; the list prints no dates).
- **Read at:** `https://www.futurehouse.org/research`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep the posts with the lab. The tracker prints titles and links only.

Credit: Posts from FutureHouse's own site.
Credit (zh): 文章取自 FutureHouse 官方網站。

### `lab-periodic-labs`

- **What:** Periodic Labs' news page (no feed).
- **Read at:** `https://periodic.com/news`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep the posts with the lab. The tracker prints titles and links only.

Credit: Posts from Periodic Labs' own site.
Credit (zh): 文章取自 Periodic Labs 官方網站。

### `lab-isomorphic-labs`

- **What:** Isomorphic Labs' news page (no feed; the list prints no dates).
- **Read at:** `https://www.isomorphiclabs.com/news`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep the posts with the lab. The tracker prints titles and links only.

Credit: Posts from Isomorphic Labs' own site.
Credit (zh): 文章取自 Isomorphic Labs 官方網站。

### `lab-lila-sciences`

- **What:** Lila Sciences' news page (no feed; the list also links outside press, which collect drops).
- **Read at:** `https://www.lila.ai/news`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep the posts with the lab. The tracker prints titles and links only.

Credit: Posts from Lila Sciences' own site.
Credit (zh): 文章取自 Lila Sciences 官方網站。

### `lab-sakana-ai`

- **What:** Sakana AI's blog (Atom).
- **Read at:** `https://sakana.ai/feed.xml`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep the posts with the lab. The tracker prints titles and links only.

Credit: Posts from Sakana AI's own site.
Credit (zh): 文章取自 Sakana AI 官方網站。

### `lab-arc-institute`

- **What:** Arc Institute's news page (no feed).
- **Read at:** `https://arcinstitute.org/news`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep the posts with the lab. The tracker prints titles and links only.

Credit: Posts from Arc Institute's own site.
Credit (zh): 文章取自 Arc Institute 官方網站。

### `lab-allen-institute-for-ai`

- **What:** Allen Institute for AI's news feed.
- **Read at:** `https://allenai.org/rss.xml`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's terms keep the posts with the lab. The tracker prints titles and links only.

Credit: Posts from Ai2's own site.
Credit (zh): 文章取自 Ai2 官方網站。

### `smc-reactions`

- **What:** Science Media Centre expert reactions, each a named scientist's own published reaction (the home page is the fallback).
- **Read at:** `https://www.sciencemediacentre.org/feed/`; fallback `https://www.sciencemediacentre.org/`.
- **Limits:** No limit stated.
- **Terms:** The centre's copyright page answered 404 on 2026-11-28, so no reuse terms were read. The tracker prints a named scientist's reaction as a short quote with the name (SPEC §4.3) and links the page.

Credit: Expert reactions from the Science Media Centre (sciencemediacentre.org).
Credit (zh): 專家回應取自英國科學媒體中心（sciencemediacentre.org）。

### `openalex`

- **What:** OpenAlex works, the Pace's weekly group-by counts (SPEC §5.1).
- **Read at:** `https://api.openalex.org/works`.
- **Limits:** One request a second (SPEC §5.1). The free key JL stores carries the backfill (SPEC §9.6).
- **Terms:** OpenAlex data are CC0.

Credit: Counts from OpenAlex (openalex.org), CC0.
Credit (zh): 統計數字來自 OpenAlex（openalex.org），採 CC0。

### `crossref-updates`

- **What:** Crossref retractions, corrections and expressions of concern for stored DOIs (SPEC §5.8).
- **Read at:** `https://api.crossref.org/works`.
- **Limits:** 5 requests a second and 1 at a time in the public pool (response headers `x-rate-limit-limit: 5`, `x-rate-limit-interval: 1s`, `x-concurrency-limit: 1`); no `mailto` is sent, so the client stays in that pool.
- **Terms:** Crossref metadata is open and its facts are CC0. No credit wording is required.

Credit: Metadata from Crossref.
Credit (zh): 詮釋資料來自 Crossref。

### `retraction-watch`

- **What:** The Retraction Watch data file that Crossref publishes, 68 MB (counter, SPEC §5.7; rung watch, SPEC §5.8).
- **Read at:** `https://gitlab.com/crossref/retraction-watch-data/-/raw/main/retraction_watch.csv`.
- **Limits:** On gitlab.com unauthenticated, 500 requests (response header `ratelimit-limit: 500`). The file was 68.4 MB with 74,173 rows on 2026-11-28, so it is read once a Monday and only when its ETag changes (`If-None-Match` gives 304).
- **Terms:** Crossref acquired the database from the Center for Scientific Integrity in 2023 and made it openly available. The repository's README gives no fixed citation line, so the line is the project's.

Credit: Retraction Watch Database (Center for Scientific Integrity), made openly available by Crossref.
Credit (zh): Retraction Watch 資料庫（科學誠信中心），由 Crossref 開放提供。

### `ctgov`

- **What:** ClinicalTrials.gov API v2, the trials of config/ai-drugs.json and of stored findings.
- **Read at:** `https://clinicaltrials.gov/api/v2/studies`.
- **Limits:** None stated on the API page read, which asks for reasonable use. A request asks for up to 100 trials (`filter.ids` with `pageSize`).
- **Terms:** U.S. government data. NLM asks for the source and the date retrieved, which each reading's `as_of` gives.

Credit: Trial records from ClinicalTrials.gov, U.S. National Library of Medicine.
Credit (zh): 臨床試驗紀錄來自 ClinicalTrials.gov（美國國家醫學圖書館）。

### `rcsb`

- **What:** RCSB PDB search API, released entries by deposit date (counter, SPEC §5.7).
- **Read at:** `https://search.rcsb.org/rcsbsearch/v2/query`.
- **Limits:** None stated.
- **Terms:** RCSB's usage policy puts the data of its programmatic APIs under CC0 1.0, and asks that RCSB PDB be cited.

Credit: RCSB Protein Data Bank (RCSB.org), data CC0 1.0.
Credit (zh): RCSB 蛋白質資料庫（RCSB.org），資料採 CC0 1.0。

### `rcsb-unreleased`

- **What:** RCSB PDB's holdings file of unreleased entries, a gzip of 1.16 MB (counter, SPEC §5.7).
- **Read at:** `https://files.rcsb.org/pub/pdb/holdings/unreleased_entries.json.gz`.
- **Limits:** None stated; one request a morning for one file, 1.16 MB as a gzip and 16.1 MB unzipped.
- **Terms:** The same RCSB usage policy is taken to cover the holdings file (it was not read separately): CC0 1.0, with RCSB PDB cited.

Credit: RCSB Protein Data Bank (RCSB.org), data CC0 1.0.
Credit (zh): RCSB 蛋白質資料庫（RCSB.org），資料採 CC0 1.0。

### `mathlib-stats`

- **What:** mathlib's statistics page (counter).
- **Read at:** `https://mathlib.org/mathlib_stats.html`.
- **Limits:** None stated.
- **Terms:** The page is generated from mathlib, which is Apache License 2.0. The tracker reads one number from it.

Credit: Statistics from the mathlib community (mathlib.org), Apache License 2.0.
Credit (zh): 統計數字來自 mathlib 社群（mathlib.org），採 Apache 2.0 授權。

### `erdos`

- **What:** erdosproblems.com, its home page with the forum and blog threads (the counter `erdos_ai` is manual and reads no feed, SPEC §5.7).
- **Read at:** `https://www.erdosproblems.com/`.
- **Limits:** None stated.
- **Terms:** The repository `teorth/erdosproblems` is Apache License 2.0. The home page no longer shows problem statuses, so the counter is read from the frozen AI contributions wiki and entered by hand (SPEC §5.7); the home page is still fetched for its thread list.

Credit: Erdős problems from Thomas Bloom's erdosproblems.com and its GitHub repository (teorth/erdosproblems, Apache License 2.0), including the AI contributions wiki.
Credit (zh): 艾狄胥問題取自 Thomas Bloom 的 erdosproblems.com 及其 GitHub 儲存庫（teorth/erdosproblems，採 Apache 2.0 授權），含其 AI 貢獻維基頁。

### `scrollprize`

- **What:** The Vesuvius Challenge's own announcements.
- **Read at:** `https://scrollprize.substack.com/feed`.
- **Limits:** No limit stated; one request a morning.
- **Terms:** The site's footer says content is licensed CC BY-NC 4.0. The tracker prints titles and links only.

Credit: Vesuvius Challenge (scrollprize.org), content CC BY-NC 4.0.
Credit (zh): 維蘇威火山挑戰（scrollprize.org），內容採 CC BY-NC 4.0 授權。

### `naer-terms`

- **What:** 樂詞網, the National Academy for Educational Research's term database (official Taiwan terms).
- **Read at:** `https://terms.naer.edu.tw/`.
- **Limits:** None stated. Collect never reads it; the Chinese pass looks terms up one at a time inside its own sandbox (SPEC §9.5).
- **Terms:** The site's about and terms pages answered 404 on 2026-11-28, so no reuse terms were found. The tracker prints each term's address (`official_url`) beside the term.

Credit: Terms from 樂詞網, National Academy for Educational Research.
Credit (zh): 詞彙取自國家教育研究院樂詞網。

## Journals with no feed

JACS and Environmental Science & Technology (their publisher's site answers every plain GET with a Cloudflare browser check, which no workaround is tried for), Acta Mathematica and the
Journal of Biblical Literature (they publish no feed) have no `journal-` feed, so they have no credit line here. Their new articles come only through `crossref-journals`, whose
credit line above covers them. The note is checked by `tests/sources-doc.test.ts`: this section holds no `Credit:` line.

## Hosts that are not feeds

### Wycliffe Global Alliance (the `full_bibles` counter)

- **What:** the annual Global Scripture Access statistics at `https://wycliffe.net/global-scripture-access/`. The totals of languages with a full Bible are drawn in infographics, not written
  in the page text, so Claude reads each image and `config/counters.json` holds the four figures with the page each came from (SPEC §5.7; K1d, 2026-11-28).
- **Limits:** none stated. The counter is manual, so nothing is fetched on a morning run.
- **Terms:** no reuse terms were read. The tracker prints one number and links the page.

Credit: Language counts from Wycliffe Global Alliance's Global Scripture Access statistics (wycliffe.net).
Credit (zh): 語言數量取自 Wycliffe Global Alliance 的「全球聖經取得統計」（wycliffe.net）。

### The AI contributions wiki of `teorth/erdosproblems` (the `erdos_ai` counter)

- **What:** `https://github.com/teorth/erdosproblems/wiki/AI-contributions-to-Erd%C5%91s-problems`, frozen on 2026-06-30 ("no longer updated"). The counter is the 69 distinct problems that it marks
  as fully resolved in its primary-contribution sections, entered by hand. Its credit is the `erdos` feed's above, which names the repository and the wiki, so this section has no credit line of its own.
- **Limits:** none stated. Nothing is fetched on a morning run.

### NCBI E-utilities, for article types (not a feed)

- **What:** the snapshot step types a cited PubMed address by its PMID through `esummary` (`db=pubmed`, the `pubtype` list) and a cited PubMed Central address by its number through `efetch`
  (`db=pmc`, the `article-type` attribute of the root `<article>`), one identifier at a time (SPEC §4.14).
- **Limits:** at most 3 requests a second without a key, the same as the `pubmed` feed, and the body is capped because an `efetch` answer holds the whole text (about 100 KB an article).
- **Terms:** nothing from these answers is printed except the type, which refuses or admits a citation. The credit is the `pubmed` feed's above, so this section has no credit line of its own.

### doi.org (not a feed)

- **What:** the DOI resolver. A cited `doi.org` address is followed to the publisher's page, which the snapshot step reads (SPEC §4.14).
- **Limits and terms:** none stated. The tracker prints the DOI and links the publisher's own page, so this section has no credit line.
