# Unveiling Tracker design v0.4

2026-11-22 · JL · Replaces v0.3 · **Settled by JL on 2026-11-22 at 15:07 Taipei (07:07 UTC)**

> This is a frozen copy of the settled design doc, a Claude Doc
> (https://claude.ai/artifact/Tx43w33Ygf52wVXpSprt1B, revision 95). Change it only through a pull
> request. Where `SPEC.md` differs, the spec wins and lists the difference in its §0.4.
>
> **Settled on 2026-11-22:** after three rounds of questions on decision cards, JL tapped "Settled,
> write the spec" on the card "Is the design settled now, so we can start to build?" at 15:07 Taipei.

| Version | Date | Changes |
|---|---|---|
| v0.4 | 22 Nov 2026 | JL's answers to eight more questions: written for JL and the people JL shares it with; the story of the day is the most significant finding; a Sunday deep dive; a Ledger of every Landmark since 2015; major harms to science reported as Setback items; primary sources only, with no outside explainers; Chinese terms in everyday Taiwan usage; the tagline. The daily Pace line also compares with a year earlier. |
| v0.3 | 22 Nov 2026 | Purpose reset by JL: stay up to date from sources JL can trust, understand each finding, stay inspired. Thesis Scoreboard dropped; a six-part explainer for every finding; the headline number now counted from outside our own picks; trust and safety rules; and JL's answers to six more questions |
| v0.2 | 22 Nov 2026 | JL's answers from the Q&A folded in: claims shown but only checked results counted, rung 3 renamed Checked, theology split into scored scholarship and an unscored Ideas and debate line, baseline 2015 to 2019, no regional angle, a Traditional Chinese edition |
| v0.1 | 22 Nov 2026 | First draft with eight open questions |

## Summary

**The Unveiling Tracker is a morning brief, on Taipei time, that keeps JL, and the people JL shares it with, up to date on what AI is helping humanity discover, explained in plain words, drawn from primary sources, and honest about how sure we are.** It covers science, mathematics, the social sciences, theology and the humanities. JL does not trust traditional media, so every item links the paper, proof or official record it rests on.

Each morning it answers three questions. What was found? What does it mean, in words a curious generalist understands? And how sure are we? Over the weeks it also answers JL's hunch: are AI-driven discoveries picking up?

Two ideas carry the design. The **explainer** tells every finding in the same six short parts, so JL can understand it and be inspired by it without a specialist's training. The **Verification Ladder** moves every finding from Claimed to Preprint, Checked, Confirmed and, later, Applied, and only Checked and above count in the numbers. Its top rung is the doorway to the application layer JL wants later.

It runs the way the siblings do: one public repo, a Kobol desktop task, Vercel, no alerts, done well before 08:00 Taipei.

### Settled with JL on 22 Nov

| Question | JL's answer | What it changes |
|---|---|---|
| Purpose | Keep me up to date from sources I can trust, clearly, in words I understand, and keep me inspired | Explanation and trust come before measurement |
| Predictions | Not important, and not fully formed | No Thesis Scoreboard; the Pace answers whether discoveries are picking up |
| Cadence | A daily brief, plus a Monday week in review | Monday carries the week's big picture and the charts |
| What counts | Claims shown, only checked results counted | Claimed and Preprint items appear, marked; only Checked and above count |
| Fields | Seven fields, AI research out | AI progress appears only as Capability items |
| Theology | Both, with scholarship scored | Texts and translation are counted; new ideas run in an unscored Ideas and debate line |
| Before-AI period | 2015 to 2019 | Every baseline and trend chart starts in 2015 |
| Regional angle | None | No Taiwan line or country count; findings on merit alone |
| Language | English plus Traditional Chinese | The site has both with a switch; the morning message stays in English; the name stays "Unveiling Tracker" |
| Explanation depth | Like the sample | The story of the day runs about 250 words in six parts; other items about 90 words in four |
| Morning message | Story in full, others as one-liners | The Claude app message carries the story of the day in full and one line per other item; about three minutes |
| Findings made without AI | Only Landmark ones | They appear, marked "no AI role", only when they change a field; every other item involves AI |
| Numbers | One line daily, charts on Monday | Each brief carries the Pace sentence; the charts appear in the Monday review and on the Trends page |
| Field balance | Best stories, two per field at most | Merit first, but no field gets more than two items a day |
| Pictures | The paper's own figure, if allowed | The site shows the key figure with credit when the licence allows; the morning message stays text |
| Audience | Me and people I share it with | Each finding gets its own link and share preview; readers can report errors, which Claude checks against the sources |
| Story of the day | Most significant first | Landmark, then Major, then Notable; among equals, the one a generalist will find most striking |
| Sunday | A Sunday deep dive | One past finding from the Ledger retold in about 500 words, with what has happened since |
| History | Landmarks since 2015 | About 100 of the biggest findings since 2015, with or without AI, checked in the build; the baseline for AI's share of the big news |
| AI harming science | Yes, when it is major | Fake papers, flawed AI results and mass retractions run as Setback items; the Monday review gathers them |
| Outside explainers | None, primary sources only | Go deeper links the paper, its data or proof, and the lab's own post; press is never linked |
| Chinese terms | Everyday usage, English once | Taiwan's everyday science usage, with the English term in brackets the first time; the Glossary adds the official term |
| Tagline | What AI is helping us discover, explained | Under the name on every page, with a Chinese version |

### What the review changed

| What I found | What changed |
|---|---|
| v0.2 was built for measurement, like CyberTracker, but your goal is understanding and inspiration | A six-part explainer for every finding; the numbers shrink to one line a day |
| The Climb counted findings the drafting agent itself chose, so it could not fairly test your hunch | The headline now uses an outside count: AI's share of papers in leading journals, against 2015 to 2019 |
| Plain words can drift from what the paper says | Every sentence traces to a source; the validator checks jargon, sentence length, hype words and reading level |
| AI labs are the loudest source, and they gain from their own claims | Lab-only claims stay Claimed; independent expert reactions are quoted when they exist |
| Biology findings can carry dangerous detail | No methods, sequences or steps that could help cause harm |
| Little is published over the US weekend | Monday is the week in review; Sunday is a deep dive from the Ledger (JL, 22 Nov) |
| Seven rows of field levels a day is noise for a generalist | Field counts move to the Monday review |
| New terms pile up | A Glossary page in both languages |
| OpenAlex indexes papers weeks late | The last eight weeks of every count are marked provisional |

You will also be able to reply to any morning message to have an item explained more simply (to confirm in the build).

## 1. Product overview

**A daily brief that tells JL what AI is helping to discover, what it means and how sure we are, in about six minutes.** It is not a science news feed and not a paper database. It picks the few findings that matter, explains each so a curious generalist understands it, and links to the paper.

### Reader

JL: college-educated with a wide background, not a working scientist, and wary of traditional media. JL reads the brief in the Claude app before 08:00 Taipei, to stay informed and inspired. The test for every item is simple: could JL explain it to a friend after one reading? The site also carries a Traditional Chinese edition behind a language switch. It is written for JL and the people JL shares it with, so every finding has its own link and share preview (JL, 22 Nov).

### What makes it different

1. **Explained, not just reported.** Every finding is told in the same six parts, with jargon defined and one line of background, and a Glossary grows with every brief.
2. **Primary sources only.** Every item links the paper, preprint, proof, dataset or official statement. Press and outside explainers are never linked (JL, 22 Nov).
3. **The Verification Ladder on every item:** Claimed, Preprint, Checked, Confirmed, Applied. A lab's announcement and a result others have checked never look the same.
4. **An AI role on every item,** including "no AI role" on the rare Landmark made without AI, so the biggest news is never missed.
5. **What didn't hold up.** Claims later walked back, not reproduced or retracted are recorded as carefully as the ones that held.
6. **Theology and the humanities beside the sciences,** which no science tracker covers.
7. **A sibling of the other trackers,** with the same family look and tab bar (ME, Europe, Cyber, Unveiling).

### Name and home

- **Name:** Unveiling Tracker (JL, 22 Nov), in both languages.
- **Repo:** `8gara8/UnveilingTracker`, public, code and daily content together, like the siblings.
- **Site:** `unveilingtracker.vercel.app` if free; the address lives in config.
- **Tagline:** "What AI is helping us discover, explained" (JL, 22 Nov). In Chinese, 「AI 正在幫我們發現什麼，說清楚、講明白」, a draft JL can change.

## 2. Editorial model

**A finding makes the brief if a curious generalist would want to know about it and it clears a bar of significance: typically one story of the day and two to four more items.** A quiet day may have fewer. Each item carries a field, a kind, an AI role, a ladder rung and a significance level.

### Fields

| Field | Examples of what counts |
|---|---|
| Mathematics | AI-found proofs or counterexamples, Erdős problems settled, proofs checked in Lean |
| Physics | Results where AI proposed, fitted or controlled something (fusion plasma control, particle physics analysis) |
| Chemistry and materials | New compounds or materials made and tested, AI-run labs, catalysts, batteries |
| Biology and medicine | Protein design, AI-found drugs entering or passing trials, new biology found by models |
| Earth and climate | Weather and climate models, geology, ecology |
| Social science | Replications, AI-run experiments and surveys, economics and history at new scale |
| Theology and humanities | Scored: ancient texts read or dated, scripture translated into new languages. Unscored: new ideas about AI, mind and faith |

At most two items come from one field each day, so biology and medicine cannot fill every brief (JL, 22 Nov).

### What counts

| Kind | Bar |
|---|---|
| Result | A specific finding, proof or object, with a paper, preprint or formal record |
| Capability | A measurable jump in what AI can do for discovery (a benchmark or a first) |
| Check | A replication, refutation, retraction or independent confirmation of an earlier claim |
| Infrastructure | Compute, data, open models or labs built for science |
| Policy and people | Funding, rules on AI authorship, prizes, notable moves |
| Idea | A notable new argument about AI, mind or faith; never scored, shown only in Ideas and debate |
| Setback | AI harming science: fake papers, flawed AI results or mass retractions. Reported when major, gathered in the Monday review, never counted as a discovery (JL, 22 Nov) |

A finding made without AI appears only if it is a Landmark, marked "no AI role" (JL, 22 Nov), so the biggest news is never missed while the brief stays about AI.

A script picks candidates before the model reads anything, from preprint servers, journals, institutions' own news releases and trial registries. It ranks them and keeps at most 40; the model reads at most 15 closely. Long-running stories, such as an AI-found drug moving through trials, return only on new facts.

### The Verification Ladder

1. **Claimed:** an announcement, blog post or talk; no paper yet. Shown, marked, never counted.
2. **Preprint:** a paper is public but not reviewed. Shown, marked, never counted.
3. **Checked:** peer-reviewed in a recognised venue, machine-checked (a Lean proof), or accepted by a recognised checker such as a prize committee or the Erdős problems site. From this rung a finding counts.
4. **Confirmed:** reproduced or verified by a team other than the authors, or a trial meets its endpoint.
5. **Applied:** in use outside the lab (a drug approved, a material in a product). The application layer takes over here.

A rung can also go down: **Disputed** or **Retracted** move the item to What didn't hold up. Every rung change is dated.

### The AI role

One primary role per item: **AI-proposed** (a hypothesis or design), **AI-solved** (a proof, structure or answer), **AI-ran** (an autonomous lab or agent did the work), **AI-tool** (a model was one instrument among many), **AI-checked** (AI verified or refuted something), or **No AI role**. Each carries a confidence: **Confirmed** by someone other than the claimant, or **Claimed** by the lab that benefits. Press reports are never a source (JL, 22 Nov). Every item about Anthropic or Claude says the tracker is written by Claude, made by Anthropic.

### Significance

- ●●●● **Landmark:** a famous open problem, a new class of drug or material, a result that changes a field.
- ●●●○ **Major:** a top-venue result that independent experts call important.
- ●●○○ **Notable:** a solid advance in a subfield.
- ●○○○ **Watch:** early or narrow, but worth following.

Landmark needs at least two independent expert reactions or the Confirmed rung. Claimed and Preprint items are capped at Notable.

## 3. How each finding is explained

**Every finding is told in the same six parts, so JL always knows where to look and never needs a specialist's training.** The story of the day gets all six in about 250 words, like the sample in the thread. Other items get the first four in about 90 words, with the rest on the site.

| Part | What it says | Rule |
|---|---|---|
| What was found | The result, in one or two sentences | No jargon; numbers with units and a comparison |
| Why it matters | What it changes, for science or for people | Concrete; never "revolutionary" |
| How AI helped | What the AI did and what people did | Names the AI system and who built it |
| How sure we are | The ladder rung and who checked it | Names who says so, and any conflict of interest |
| Background | The one idea you need, in a line | Linked to the Glossary |
| What it could lead to | A possible use or next step | Always labelled a possibility; seeds the application layer |

Each item ends with **Go deeper**: the paper, its data or proof, and the lab's own post. Press and outside explainers are never linked (JL, 22 Nov).

**Writing rules the validator checks.** Sentences under 25 words. A technical term is defined the first time it appears, or links to the Glossary. A banned list of hype words ("revolutionary", "game-changing", and "breakthrough" unless the item is a Landmark). Every sentence traces to a cited source, and every number comes from the source, never an estimate. An English reading-level score of grade 12 or below.

**Asking for more.** JL can reply to the morning message, for example "explain item 2 more simply", and Claude answers from that day's sources (to confirm in the build).

### Sample: a story of the day

Written from a real result of February 2024 to show the style.

> **A scroll burned by Vesuvius is read without being opened** Theology and humanities · AI as a tool · Checked
>
> **What was found.** Three students used AI to read more than 2,000 Greek letters, about 5% of a scroll that was turned to charcoal when Mount Vesuvius erupted in AD 79. The scroll has never been unrolled.
>
> **Why it matters.** Hundreds of scrolls from the same buried library at Herculaneum are still rolled up, too fragile to open. This showed that whole passages can be read without touching them.
>
> **How AI helped.** X-ray scans show the rolled layers, but the ink is carbon on charred papyrus, so it barely shows up. A machine-learning model learned to spot the faint traces the ink leaves on the papyrus fibres, and people then read the letters it revealed.
>
> **How sure we are.** Checked. Papyrologists reviewed the readings before the $700,000 Vesuvius Challenge prize was awarded in February 2024. The passage, probably by the philosopher Philodemus, asks whether scarce pleasures are greater than plentiful ones.
>
> **Background.** "Virtual unwrapping" means flattening the layers of a 3D scan in software, so the scroll stays rolled and intact.
>
> **What it could lead to.** Works lost for 2,000 years could be read again if the method scales to whole scrolls. This is a possibility, not yet a result.
>
> **Go deeper.** The prize announcement and the paper on the scanning method (linked in the real brief).

## 4. The Pace: is it picking up?

**The Pace answers JL's hunch in one sentence each morning: are AI-driven discoveries picking up compared with 2015 to 2019?** Scripts compute every number from public data; the model never writes one. The daily brief carries the sentence, and the charts appear on Mondays and on the Trends page (JL, 22 Nov). The sentence compares the latest firm 13 weeks with 2015 to 2019 and with the same weeks a year earlier, so it shows both how far AI has come and whether it is still picking up.

- **A. AI in leading journals (the headline).** The weekly share of papers in leading journals (such as Nature, Science, Cell, PNAS, Physical Review Letters and Annals of Mathematics) whose title or abstract names AI methods, per field, from OpenAlex. It is counted from outside our own picks, so it can fairly test the hunch.
- **B. The Flood.** The same share across all papers in each field. It measures adoption, not discovery, and says so.
- **C. AI's share of the big news.** Of the Landmark findings in the brief, the only level where findings made without AI also appear, the share with an AI role. It rests on our own picks and Landmarks are rare, so it is shown but never used as the headline. The Ledger's history of every Landmark since 2015 gives it a before-AI baseline (JL, 22 Nov).
- **D. Hold rate.** Of AI claims made six or more months ago, the share that reached Checked, against the share disputed or retracted.

Field counters, each dated: Erdős problems solved with AI credit, theorems formalised in Lean's mathlib, AI-found drugs in each trial phase (ClinicalTrials.gov), protein structures deposited, retractions of AI-assisted papers (Retraction Watch data via Crossref), languages gaining a full Bible each year (Wycliffe Global Alliance), and ancient texts read with AI help. The Ideas and debate line is never counted.

The sentence says "faster than before AI" only when the data clears a set threshold with at least 30 cases; otherwise it says "no clear change". OpenAlex indexes papers weeks late, so the last eight weeks of every count are marked provisional.

### Trends page

One page on a shared time axis from 2015 to today: A and B per field as small multiples, C, D, the counters, and dated markers (AlphaFold 2 in 2020, ChatGPT in November 2022, the AlphaFold Nobel in October 2024, others from config). Weekly and monthly views, never daily raw counts. Every metric file is kept per day in git, so the history grows on its own and can be recomputed.

## 5. Page design

**One page per morning, read in about six minutes, with the Pace sentence and the story of the day readable in two.** About 1,000 words, hard cap 1,300, counted by the validator; the Chinese edition gets its own cap in characters.

1. **Masthead.** Taipei date, edition time, the Pace sentence, the tab bar (ME, Europe, Cyber, Unveiling) and a language switch (English, 中文). No day count.
2. **The Lead.** At most 60 words on what today adds up to, written last, each sentence tied to its items.
3. **Story of the day.** One finding in all six parts, about 250 words, with the paper's own figure on the site when its licence allows (JL, 22 Nov). It is the day's most significant finding (Landmark, then Major, then Notable); among equals, the one a generalist will find most striking (JL, 22 Nov).
4. **More findings.** Two to four items in the first four parts, about 90 words each, each opening to the full explainer on the site.
5. **Climbed or fell.** Earlier findings whose rung changed today, for example "Preprint to Checked".
6. **Ideas and debate.** Up to two unscored lines on new arguments about AI, mind and faith, on days there are any.
7. **Also noted.** Up to five one-line headlines with links, for findings that did not make the cut.
8. **Sources,** collapsed. The page ends "That's today's brief."

**Monday, the week in review:** The big picture (about 300 words on what changed in our understanding this week), the week's most remarkable finding, the Pace charts, the week's field counts, What didn't hold up, and a "Strongest evidence against" box that gathers the week's setbacks and reads "none found" when there are none.

**Weekends.** Sunday and Monday mornings in Taipei follow the US weekend, when little is published. Monday is the week in review. Sunday is a deep dive: one past finding from the Ledger retold in about 500 words, with what has happened since, plus any big news in a line (JL, 22 Nov). It prefers a finding with news that week or an anniversary, and moves between fields.

### The morning message

The Claude app message carries the Pace sentence, the story of the day in full, and one line per other item with its link: about three minutes to read (JL, 22 Nov). A script composes it from the same data, so it always matches the site.

### Other pages

- **Trends:** section 4.
- **Ledger:** every finding, filterable by field, rung, AI role and year, with its dated ladder history. The application layer will build on it.
- **Glossary:** every term the brief has explained, in both languages, growing each day.
- **What didn't hold up:** claims that fell, with what happened.
- **Archive, Methodology, About** ("Written each morning by Claude, Anthropic's AI, without human review. Numbers are computed by scripts.").

Every page exists in English and Traditional Chinese with the same data; only the words differ. Every finding has its own page and link, a share preview and a "Report an error" link (JL, 22 Nov).

### When things go wrong

The brief degrades in steps: full, then partial (stale feeds named), then a data-only edition (the Pace sentence and new rung changes, no explainers), then a "Not updated today" banner after 08:00, checked in the browser. Corrections never silently edit an archived page: a corrected item gets a dated banner, and the next brief lists the correction. Readers' error reports are checked against the sources the next morning; an upheld report becomes a correction, and the brief says so.

## 6. Information architecture

**The central record is the Finding, not the daily brief.** Briefs point at findings, and findings outlive briefs, which makes the trends, the Ledger and the later application layer possible without a rewrite.

### Finding (one per result, long-lived)

| Field | Notes |
|---|---|
| id | Stable, for example `math-2026-0142`; never reused |
| title | In both languages; plain words, no jargon |
| explainer | The six parts in both languages (section 3) |
| field, subfield | From a fixed list in config |
| kind | Result, Capability, Check, Setback, Infrastructure, Policy and people, Idea |
| ai_role, ai_confidence | Section 2; includes "no AI role" |
| significance | Landmark, Major, Notable, Watch |
| rung_history | Dated rungs, each with the source for the change |
| sources | The paper, preprint, proof, dataset or statement, plus any independent expert reactions |
| artefacts | DOI, arXiv id, Lean file, trial id, PDB id |
| figure | The paper's figure, its licence and credit, when reuse is allowed |
| who | Institutions and labs; stored for the application layer, not shown as a regional angle |
| terms | Glossary terms the explainer uses |
| applications | Empty for now; reserved for the application layer |

### Other records

- **Brief (one per day):** date, Pace sentence, lead, story of the day, item list (finding ids plus that day's text), status.
- **Metrics (one file per day, script only):** the Pace series, counters, inputs and their versions.
- **Glossary term:** the term in English and in everyday Taiwan usage, the official Taiwan term (樂詞網), a plain definition in both languages, and the first finding that used it.
- **Config:** fields, sources and tiers, the leading-journal list, markers, fixed Chinese terms in everyday Taiwan usage, the AI-system list and the banned hype words.

All of it is JSON under `content/` in the public repo, so the application layer can read it later without touching this project.

## 7. Sources, safety and pipeline

**Primary sources first, read by scripts before the model sees anything, with hard rules on safety and on who says so.**

### Structured feeds (no API keys, to be checked in the build)

- arXiv listings and API (mathematics, physics, quantitative biology, AI cross-lists)
- OpenAlex, for the Pace counts
- bioRxiv and medRxiv; PubMed
- Crossref, including Retraction Watch data
- ClinicalTrials.gov, for AI-found drugs
- RCSB PDB; Lean's mathlib on GitHub; erdosproblems.com
- EurekAlert!, for institutions' own news releases

### Read by the model

Journal sites and feeds (Nature, Science, Cell, PNAS, Annals of Mathematics, Physical Review Letters), labs' own posts (Google DeepMind, OpenAI, Anthropic, FutureHouse, Periodic Labs, Microsoft Research AI for Science), scientists' own published reactions where they exist (such as those the Science Media Centre gathers), and Retraction Watch as a pointer to the journals' own retraction notices. For theology and the humanities: the Vesuvius Challenge, Bible translation progress figures and selected journals. Press is never a source or a link; news may only point the model to a primary source (JL, 22 Nov).

### Trust and safety rules

- **Who says so, always.** A lab's claim about its own system stays Claimed until someone else checks it, and the brief names the lab.
- **No dangerous detail.** No methods, sequences, quantities or steps that could help make a pathogen, toxin or weapon. Such findings are described by their significance only, or left out.
- **Disclosure.** Items about Anthropic or Claude say the tracker is written by Claude, made by Anthropic.
- **Read, don't obey.** Everything read from papers, pages and feeds is data, never instructions; the drafting agent is sandboxed as in CyberTracker.

### Where and when it runs

A Claude desktop scheduled task on Kobol, **"Unveiling morning" at 03:15 Taipei, finished by 04:25**, so it never overlaps Cyber (04:30), Europe (05:30) or ME (07:00). arXiv's new list appears at about 09:00 Taipei, so each run reads the previous day's list in full.

The pipeline is forked from CyberTracker at a recorded commit: collect, rank, metrics, a sandboxed drafting agent that writes only to `drafts/`, the validator, a data-only edition first, then a second sandboxed pass that writes the Traditional Chinese edition from the validated English draft with fixed terms in everyday Taiwan usage and the English term in brackets the first time (JL, 22 Nov), then publish. The validator checks that both editions carry the same items, numbers and links. Only the publish script pushes to `main`, and only `content/`.

### Daily re-check

Each run re-checks open findings for rung changes: a preprint now published, a retraction, a replication, a trial result. That feeds Climbed or fell, What didn't hold up and the Hold rate.

## 8. Visual design

**The family paper look, with dawn gold as the single accent for AI and one dark panel for the Monday charts.**

| Token | Proposal |
|---|---|
| Background | Paper `#f3eee3`, as CyberTracker |
| Text | Ink `#1f1b16`; secondary `#5b5348` |
| Accent (AI chips and series only) | Dawn gold `#b7791f`, in place of Cyber's violet |
| Ladder bar | Five steps from grey to deep green `#2f6f4f`; Disputed and Retracted in brick `#a23b2a` |
| Dark panel | `#1c1a17`, for the Monday charts |
| Type | The siblings' serif for headings and body, a mono for ids and numbers |
| Chinese type | Noto Serif TC for headings and body, Noto Sans TC for small labels |
| Spacing | 8 px base; cards 16 px padding; 640 px reading column, charts up to 960 px |

The explainer's six parts sit as small labelled rows, so a reader can skim the labels and stop where they like. Field icons are small text glyphs, so the page stays light on a phone. The colour check in the site phase verifies every pair, and JL picks the accent on real screenshots, as for Cyber.

## 9. Decisions, build phases, rejected options

### Key decisions

| Decision | Why |
|---|---|
| Explanation and trust before measurement | JL's purpose: stay up to date, understand, be inspired |
| The Finding is the core record | Trends, the Ledger and the application layer need long-lived records, not daily text |
| The headline number is counted from outside our own picks | A count of the model's own choices cannot fairly test the hunch |
| Compare with 2015 to 2019 | A baseline inside the AI era cannot show whether AI changed anything |
| Record what didn't hold up | Without it the tracker could only ever confirm the hunch |
| Run on Kobol, one repo, Vercel, fork Cyber's pipeline | The lesson from Cyber: the fewest manual steps for JL |
| No alerts, morning only, done by 04:25 | JL's standing rule |
| Primary sources only, no outside explainers | JL does not trust traditional media, so every link is the record itself (JL, 22 Nov) |

### Build phases (after JL approves the design)

Each phase is one PR, opened ready for review: Claude builds, Codex reviews, Claude fixes, JL merges.

1. **Foundation:** SPEC.md, the repo forked from CyberTracker, config, no Cyber strings left.
2. **P1 Data contract:** the Finding schema with the explainer in both languages, the validator and its writing rules, sample data, the English morning message.
3. **P2 Feeds, metrics and backfill:** every feed checked, the Pace from 2015, and a hand-checked Ledger of every Landmark since 2015, with or without AI, about 100 findings (JL, 22 Nov).
4. **P3 Morning pipeline:** dry runs on two past days, the Chinese pass, a forced failure, timing.
5. **P4 Site:** every page in both languages, including Trends, Ledger and Glossary; share previews and the error-report form; screenshots; JL picks the accent.
6. **P5 Supervised go-live:** three mornings, then unattended.
7. **Calibration** about four weeks later, including a check of the reading level with JL.

JL's manual steps should be only: answer the design questions, merge PRs, store the agent token once on Kobol, and set the task time once.

### Considered and rejected

- **A Thesis Scoreboard:** JL's predictions are a hunch, not claims to score; the Pace answers whether discoveries are picking up (JL, 22 Nov).
- **Counting our own picks as the headline:** the model chooses them, so they cannot test the hunch.
- **Counting AI papers as the headline:** volume is not discovery, so adoption is shown as context only.
- **Showing only checked results:** JL weighed it and chose to show claims, clearly marked, while counting only checked ones (22 Nov).
- **AI research as an eighth field:** it would crowd out the fields the thesis is about (JL, 22 Nov).
- **A Taiwan line or a country count:** JL chose findings on merit alone (22 Nov).
- **A Chinese name:** the Chinese edition keeps "Unveiling Tracker" (JL, 22 Nov).
- **Diagrams drawn by Claude:** a drawn diagram can be wrong in ways that are hard to spot (JL, 22 Nov).
- **Building the application layer now:** out of scope; the `applications` field, the Applied rung and the "What it could lead to" line keep the door open.
- **Outside explainers and press links:** JL chose primary sources only (22 Nov).
- **A short or quiet Sunday brief:** Sunday is a deep dive from the Ledger instead (JL, 22 Nov).
- **Picking the story of the day by inspiration or by rotating fields:** significance comes first (JL, 22 Nov).
