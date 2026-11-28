# K2d: full author lists and Nature commentary links (P2, on Kobol)

Checked on 2026-11-28, from about 21:57 to 22:40 Taipei (13:57 to 14:40 UTC), on Kobol, for the 108
candidates of `docs/reports/p2-ledger/K2d-input.json`. The requests were GETs with the run's user
agent, one a second to any host (arXiv 3 s), 15 s, 5 redirects and a 3 MB cap.

- **Crossref:** every DOI's work record. Each author is listed in order, with ORCID and every
  affiliation Crossref gives.
- **Where Crossref lacked affiliations** for at least half the authors:
  - **arXiv DOIs:** the arXiv API.
  - **bioRxiv and medRxiv DOIs:** their details API (authors and the corresponding institution).
  - **Everything else:** OpenAlex's single-work endpoint, `/works/doi:<doi>`, used 151
    times. I used it **keyless**: going through the stored key would mean reading the keychain, which
    the brief rules out. OpenAlex does not charge single-record lookups against the budget.
- **Nature pages:** each was read for every link to `/articles/d41586-` and for its "Associated
  content" or "Related" block. Each linked page was then read for its title, type (`dc.type`), byline,
  affiliation line, date and up to three passages about the original result.

All 61 passages are word for word in the page text (0 are not).

Outputs:

- `K2d-authors.json`: by DOI. Where OpenAlex filled the gap, its `authorships` are kept beside the list.
- `K2d-commentary.json`: by Nature URL.

## Counts

- **DOIs:** 251 unique. 247 resolved, with authors listed. 4 did not resolve.
- **Author lists by source:** openalex 151, crossref 93, biorxiv 3.
- **Affiliations:** 222 DOIs have an affiliation for every author, and 226 for at
  least 80% of authors.
- **Corrections, retractions or other updates:** 13 works carry an `updated-by` entry:
  10.1038/s41586-023-06734-w (correction); 10.1038/s41562-025-02194-6 (correction); 10.1038/s41550-024-02472-9 (correction); 10.1016/j.cell.2020.01.021 (erratum); 10.1038/nature22336 (correction); 10.1073/pnas.2203150119 (correction); 10.1177/2515245917747646 (correction); 10.1103/physrevlett.126.141801 (correction); 10.1073/pnas.2107346118 (correction); 10.1038/s41586-023-06185-3 (correction); 10.1038/s41586-019-1260-x (correction); 10.1038/s41586-019-1043-4 (retraction, retraction); 10.1038/s41586-024-08449-y (correction).
- **Nature pages:** 70 of 70 read.
- **`d41586-` links found:** 31 unique. By type: News And Views 18, Research Briefings 4, Nature Podcast 4, News 2, Nature Video 1, World View 1, News & Views Forum 1.
- **Failures:** 10.5281/zenodo.10813168: crossref 404; 10.3886/icpsr37353.v1: crossref 404; 10.1126/science.aad4962: crossref 404; 10.1016/j.cell.2021.06.049: crossref 404.
  - The Zenodo and ICPSR DOIs are DataCite DOIs, so they are not wrong.
  - **`10.1126/science.aad4962` and `10.1016/j.cell.2021.06.049` are not in Crossref at all**, so both are
    probably wrong DOIs. K2c already flagged the Cell one.
- **Affiliation lines** on the commentary pages are cut to each byline author's own sentence ("X is in
  the Department of ...").

## Candidates that now have a News & Views or Comment

20 of the 108 candidates have at least one `d41586-` News & Views or Comment linked from
their Nature paper:

- **aeneas-latin-inscriptions-context-restoration**: News And Views: https://www.nature.com/articles/d41586-025-02132-6 (Tupman, Charlotte)
- **aguada-fenix-oldest-largest-maya-monument**: News And Views: https://www.nature.com/articles/d41586-020-01570-8 (McAnany, Patricia A.)
- **ai-chatbot-chats-shift-voter-preferences**: News And Views: https://www.nature.com/articles/d41586-025-03733-x (Vargiu, Chiara, Nai, Alessandro)
- **alphaproof-imo-2024-silver-level**: News And Views: https://www.nature.com/articles/d41586-025-03585-5 (Ringer, Talia)
- **alphaqubit-neural-quantum-decoder**: News And Views: https://www.nature.com/articles/d41586-024-03557-1 (Haider, Nadia)
- **bennu-samples-ammonia-nucleobases-ancient-brine**: News And Views: https://www.nature.com/articles/d41586-025-00084-5 (Sekine, Yasuhito)
- **centaur-model-predicts-human-choices**: News And Views: https://www.nature.com/articles/d41586-025-02353-9 (Baggio, Giosuè)
- **coscientist-language-model-agent-runs-chemistry**: News And Views: https://www.nature.com/articles/d41586-023-03790-0 (Dias, Ana Laura, Rodrigues, Tiago)
- **dart-asteroid-orbit-changed**: News And Views: https://www.nature.com/articles/d41586-023-01020-1 (Adam, Coralie D.)
- **fast-petase-machine-learning-plastic-enzyme**: News And Views: https://www.nature.com/articles/d41586-022-01075-6 (Thoden van Velzen, Eggo U., Santomasi, Giusy)
- **fruit-fly-brain-wiring-map-flywire**: News And Views: https://www.nature.com/articles/d41586-024-03029-6 (Devineni, Anita V. )
- **hunga-tonga-eruption-global-waves**: News And Views: https://www.nature.com/articles/d41586-022-01855-0 (Lane, Emily M.)
- **ithaca-restores-dates-greek-inscriptions**: News And Views: https://www.nature.com/articles/d41586-022-00641-2 (Roueché, Charlotte)
- **kalambo-falls-earliest-wooden-structure-476000**: News And Views: https://www.nature.com/articles/d41586-023-02858-1 (Milks, Annemieke)
- **logical-qubits-atom-array-processor**: News And Views: https://www.nature.com/articles/d41586-024-00075-y (Terhal, Barbara M.)
- **maya-lidar-reveals-lowland-civilisation**: News And Views: https://www.nature.com/articles/d41586-020-01570-8 (McAnany, Patricia A.)
- **nllb-200-translates-200-languages**: News And Views: https://www.nature.com/articles/d41586-024-00964-2 (Adelani, David I.)
- **old-kingdom-egyptian-genome-nuwayrat**: News And Views: https://www.nature.com/articles/d41586-025-00755-3 (Prendergast, Mary)
- **pangu-weather-3d-neural-network-forecast**: News And Views: https://www.nature.com/articles/d41586-023-02084-9 (Ebert-Uphoff, Imme, Hilburn, Kyle)
- **score-project-social-science-replicability**: News & Views Forum: https://www.nature.com/articles/d41586-026-00805-4 (Sánchez-Tójar, Alfredo, Wicherts, Jelte M., Willer, Robb)

A byline with its affiliation line, where the page shows one, is in `K2d-commentary.json`. That lets
the writers check that the commentator is outside the original team.
