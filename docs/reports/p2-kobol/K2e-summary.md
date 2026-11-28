# K2e: the 20 Nature commentary pages (P2, on Kobol)

Checked on 2026-11-28, about 22:45 to 23:00 Taipei (14:45 to 15:00 UTC), on Kobol. Each page of
`docs/reports/p2-ledger/K2e-input.json` was fetched with a plain GET: the run's user agent, 15 s,
5 redirects, a 3 MB cap, and one request a second.

The article text is the page's own body paragraphs only: the article column, without the header, the
access box, references, author notes, "latest content" lists and job advertisements. For each page,
`K2e-commentary.json` gives:

- the status, article type, title and standfirst;
- the byline, with each author's own affiliation sentence where the page shows it (for example "... is
  in the Department of ..., University of ...");
- the date, and the number of characters of article text read;
- whether the page is cut off;
- the passages and the body links.

The passages are the first three sentences of the body, then any later sentence that judges the work,
each at most 40 words. The links are the body links to nature.com, sciencemediacentre.org or a
university domain.

## Counts

- **Pages read:** 20 of 20, all status 200. News And Views 18, World View 1, News & Views Forum 1.
- **Pages cut off:** all 20. Each shows Nature's access options, the subscribe or "Access
  through your institution" box, after the opening paragraphs. A plain GET reads only the opening:
  464 to 1598 characters of body text. So the judging sentences
  further down are mostly not readable, and most pages give only their first two or three sentences.
- **Passages:** 56, all word for word from the extracted text. One quotes Nature's own em dash,
  which is kept as written.
- **Body links:** 20 (mostly the "Writing in Nature" link to the paper discussed).
- **Bylines:** names on every page. An affiliation sentence was found on 18 pages.

## Pages under 800 characters of text

- https://www.nature.com/articles/d41586-020-01393-7 (World View, 514 characters): 2 passages
- https://www.nature.com/articles/d41586-026-00805-4 (News & Views Forum, 464 characters): 0 passages

For the writers: each page still gives its title, standfirst, byline, affiliation and date, which is
enough to show that an outside scientist commented. The judging sentences behind the paywall cannot be
quoted from a plain GET. The standfirst, written by Nature, is the one readable summary of each piece's
view.
