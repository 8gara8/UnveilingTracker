# Provenance

The Unveiling Tracker is forked from **8gara8/CyberTracker at `3ced1fbb55dae010efcae659c0eabe36e43934f8`**
(`main` on 2026-11-16 at 08:12 Taipei, 00:12 UTC: "P5 report: go-live report, the task as set up, start
times (row 186)"). It is the newest code commit when the fork was made on 2026-11-22: every later commit on
CyberTracker's `main` changes only `content/`. Nothing was merged from Git history: files were copied by
hand into a fresh repository and changed as below. CyberTracker itself is a fork of 8gara8/EuropeTracker
(its own `docs/PROVENANCE.md`).

Verdicts:

- **copied:** the same code, with only comments, names and imports changed;
- **adapted:** the same job, changed where this project differs (the "What changed" column);
- **later (Pn):** not copied in the Foundation PR; the phase named copies it from the fork commit and
  adapts it, or writes it anew, and that phase's PR moves the row to copied, adapted or replaced;
- **dropped:** not carried over (SPEC §2 "Dropped from CyberTracker" says why);
- **replaced:** written anew for this project;
- **new:** no CyberTracker source.

Every copied or adapted file names its CyberTracker source in its header comment. "Cyber's X" in SPEC.md
means file X at the fork commit.

## Scaffolding and repository files

| CyberTracker file | Verdict | What changed |
|---|---|---|
| `package.json` | adapted | Name `unveilingtracker`; the same packages and exact pins (SPEC §2); only the Foundation scripts (`postinstall` writing `node_modules/.ut-lock-sha`, `typecheck`, `test`, `check`); each later script lands with the phase that builds its file (SPEC §8.1) |
| `package-lock.json` | adapted | CyberTracker's lockfile with the name changed, so the dependency tree is the one CyberTracker runs on Kobol; `npm ci` installs it |
| `tsconfig.json` | copied | |
| `vitest.config.ts` | copied | Comment only; it loads `tests/setup/offline.ts` from Foundation on |
| `.gitignore` | copied | In the bootstrap commit; exactly SPEC §3's list |
| `.github/workflows/ci.yml` | copied | SPEC §9.2 |
| `.github/pull_request_template.md` | copied | SPEC §10 |
| `.github/ISSUE_TEMPLATE/config.yml` | copied | Blank issues off |
| `.github/ISSUE_TEMPLATE/correction.yml` | dropped | Replaced by `error-report.yml` (new): three fields, the finding id, what is wrong and an evidence link (SPEC §9.2) |
| `.gitattributes` | later (P1) | Marks this project's generated fixtures and schemas |
| `next.config.ts`, `postcss.config.mjs` | later (P4) | The content security policy with `figure_hosts` (SPEC §3, §7) |
| `README.md`, `AGENTS.md`, `CLAUDE.md`, `SPEC.md` | replaced | Written for this project |
| `docs/DESIGN.md` | replaced | Design v0.4 exported from its Claude Doc and frozen |
| `docs/PROVENANCE.md` | replaced | This file |
| `docs/RUNBOOK.md` | later (P3) | This project's morning, error codes and recovery |
| `docs/SOURCES.md` | later (P2) | This project's feeds, their terms and credit lines |
| `docs/SEED-CONFIG.md` | dropped | SPEC §4.11 and Appendix B hold this project's seeds |
| `docs/reports/**`, `docs/screenshots/**` | dropped | CyberTracker's own records |
| `content/**` | dropped | CyberTracker's published data |

## Config (`config/`)

| CyberTracker file | Verdict | What changed |
|---|---|---|
| `config/run.json` | adapted | SPEC §4.11: this project's site, repo, siblings, schedule (03:15 to 04:25), budgets (the Chinese pass, the reading grade, reports), pack window, Pace settings, paths, user agent and task name |
| `config/sources.yaml` | adapted | Drafted from SPEC §4.13 in CyberTracker's registry format with `arxiv_skipped`, `fields`, `parser` and `budget` added, the language, region and coverage keys dropped and `fresh_days` null for a feed with no dated items; P2 finalises every URL, `fresh_days` and `date_zone` on Kobol |
| `config/source-tiers.json` | later (P1) | Rewritten as the primary-source allowlist and the press deny list (SPEC §4.11) |
| `config/annotations.json` | later (P1) | Becomes `markers.json`: dated chart markers in both languages |
| `config/standing-stories.json` | later (P1) | The same idea for this project's long-running stories; empty at version 1 |
| `config/{actors,ai-finders,claims,regions,vendors,watch-windows}.json` | dropped | CyberTracker's domain and the Thesis Scoreboard (SPEC §2) |

## Libraries (`lib/`)

| CyberTracker file | Verdict | What changed |
|---|---|---|
| `lib/dates.ts` | copied | Comments only. The data cutoff, ISO weeks and windows serve the Pace (SPEC §4.1, §5.3) |
| `lib/json.ts` | copied | Comment only |
| `lib/format.ts`, `lib/metrics/stats.ts` | later (P1) | The date formatters and §5.2's statistics and display helpers (`wilson80`, `newcombe80`, `roundTo`, `pct`); the EPSS notes dropped |
| `lib/sanitize.ts` | later (P1) | `sanitize()` and the untrusted-text wrapper, with P1's `INJECTION_PATTERNS` |
| `lib/text.ts` | later (P1) | `countWords()`; `splitSentences()` rewritten to SPEC §4.1's rules, the one splitter; the CVE and advisory number patterns dropped |
| `lib/urls.ts` | later (P1) | `normalizeUrl()`, `hostOf()`, `hostMatches()`, `extractUrls()`, `blockedEntry()` (which also matches label entries) and `safeHref()`, which drops its github.com path check, so the file reads no config (SPEC §7); the defang helpers dropped; the tier lookups give way to `lib/primary.ts` |
| `lib/vocab.ts` | later (P1) | Every vocabulary in both languages (SPEC §4.2); `BLOCKED_HOSTS` without the exploit archives and code hosts (`exploit_code`), plus the shadow libraries (`shadow_library`) and label entries, which `blockedHostEntries()` skips |
| `lib/schema/common.ts` | later (P1) | `IsoDate`, `IsoTimestamp`, `PublishedAt`, `Interval`, plus `L10n` and this project's shared types |
| `lib/schema/{brief,config,context,draft-brief,index,metrics,misc,pack,registry,status}.ts`, `lib/schema/item.ts` | later (P1) | Rewritten for findings, briefs, the Chinese draft and this project's configs (SPEC §4); `item.ts` becomes `finding.ts` and `draft-brief.ts` `draft.ts`; `draft-zh.ts`, `glossary.ts` and `seed.ts` (P2) are new (SPEC §4.1) |
| `lib/schema/reference.ts` | later (P2) | This project's Appendix D reference |
| `lib/schema/scoreboard.ts` | dropped | No Scoreboard (SPEC §2) |
| `lib/validate.ts`, `lib/json-schema.ts`, `lib/rules/{types,index,shared}.ts` | later (P1) | The validator's frame, `validateAll()`, the compact JSON Schema printer |
| `lib/rules/{words,sources,computed,snapshots,grounding,meta,ids}.ts` | later (P1) | The rules whose job is the same, rewritten for findings and both languages (SPEC §4.12) |
| `lib/rules/{ai,items}.ts` | later (P1) | Rewritten as the AI-role and finding rules |
| `lib/rules/{cves,naming}.ts` | dropped | CVE rules, victims and attribution (SPEC §2) |
| `lib/rules/safety.ts` | later (P1) | `SECRET_LIKE` (`SECRET_PATTERNS`, `secretsIn()`), kept as Cyber's (SPEC §4.12); the exploit and live-indicator rules dropped: `DUAL_USE` replaces them, and `BLOCKED_HOST` keeps their checks of URLs on `BLOCKED_HOSTS` (SPEC §2, §4.12) |
| `lib/config.ts`, `lib/chat.ts`, `lib/page-text.ts` | later (P1) | `loadConfig()`; the chat edition (SPEC §8.8); every page string in both languages |
| `lib/sources.ts` | later (P1) | Source kinds and publishers (SPEC §3) |
| `lib/ids.ts` | later (P1) | The explicit comparators; the CVE and advisory comparators dropped |
| `lib/items.ts` | later (P1) | Display order, the fields computed from a finding alone, and `filedAs()` (SPEC §4.10) |
| `lib/collect.ts`, `lib/rank.ts` | later (P2) | The collector's pure parts and the pack; ranking and the 40 cap (SPEC §5.9) |
| `lib/feeds/{http,cache,rss,types}.ts` | later (P2) | `fetchFeed()` with generic limits and `UT_FIXTURE_FEEDS`, plus one queue per rate-limited host (SPEC §4.13); this project's cache paths and parsers |
| `lib/feeds/{anthropic-cvd,cvelist,epss,exchange,ghsa,github,kev,myjvn,nvd,zip}.ts` | dropped | CyberTracker's feeds (SPEC §2) |
| `lib/metrics/index.ts` | later (P2) | The pattern for this project's metrics run (SPEC §5) |
| `lib/metrics/{ai-credit,fix-side,flood,headline,home-vendors,kev-index,notes,reference,series,window}.ts` | dropped | The Gap, the Window, the Flood, AI credit and the fix side (SPEC §2); the Pace is new (`pace.ts`, `ledger-stats.ts`, `counters.ts`) |
| `lib/context.ts`, `lib/apply.ts`, `lib/data-only.ts`, `lib/run-inputs.ts` | later (P3) | The agent contexts, drafts to writes, the data-only edition, the run's inputs (without its KEV, regions, Scoreboard and withheld reads); P1 copies early the pure helpers of `lib/apply.ts` that its tests and `fixtures/src/` use (`SNAP_CODES`, `dropUnverified()`, `freezeSource()`, `ComposeError` and the composers the sample is built with) |
| `lib/html-text.ts` | later (P2) | Page text for `ledger-seed --verify`'s quotes and page hashes (SPEC §8.13), then the snapshots and the link check, so every hash is read the same way |
| `lib/content.ts` | later (P1) | `loadContent()`, its keep-last-good rule and `SITE_BLOCKING_CODES` with this project's codes (SPEC §4.12, §6), whose skips the chat edition and the reply file follow (SPEC §8.8) |
| `lib/site.ts`, `lib/site-data.ts`, `lib/stale.ts`, `lib/markdown.ts` | later (P4) | The site's constants, loaders, stale banner and Markdown (P1 copies `lib/site.ts` early, for the chat edition's `siteUrl()` and `lib/content.ts`'s `contentDir()`) |
| `lib/regions.ts`, `lib/record-links.ts`, `lib/withhold.ts`, `lib/withhold-mask.ts` | dropped | Region levels, CVE record links and withholding (SPEC §2) |

## Scripts (`scripts/`)

| CyberTracker file | Verdict | What changed |
|---|---|---|
| `scripts/lib/run.ts`, `scripts/lib/lock.ts`, `scripts/lib/log.ts` | copied | Comments only |
| `scripts/lib/git.ts` | adapted | The fallback commit identity is `UnveilingTracker` `run@unveilingtracker.invalid`; `syncMain()` also reads the paths of each local commit origin lacks (a rename as a delete and an add) and checks the rebased commits, putting main back when one touches a path outside the layout, where CyberTracker's reads only the tip's diff, which a revert, a rename into `content/` or a merge with `-s ours` leaves clean (SPEC §8.7, §0.4 row 101) |
| `scripts/lib/clock.ts` | adapted | The --no-deadline gaps are SPEC §8.2's: the retry cutoff 35 minutes and the Chinese pass's start 20 minutes before the hard stop (CyberTracker: 50, no Chinese pass); the other limits are CyberTracker's TIMEOUTS, which P3 checks against §8.2 |
| `scripts/lib/keychain.ts` | adapted | The service is `unveiling-claude-oauth` |
| `scripts/lib/{agent,transcript,validate-loop,status,deploy,paths,prune,run-lines}.ts` | later (P3) | The agent harness for two passes, transcripts, the repair loop, status records, the deploy check, paths, pruning and run lines |
| `scripts/lib/{snapshot,evidence}.ts` | later (P2) | Page snapshots and the evidence made from them, for `ledger-seed --verify` (SPEC §8.13); the morning's snapshot step and the transcripts' part of the evidence are used from P3. The snapshot step keeps each page's `article_types` and a failed GET's final URL, and the evidence adds `types` and `resolved` (SPEC §4.11) |
| `scripts/lib/{feeds,feed-cache}.ts` | later (P2) | The feed readers and what the metrics read back from `cache/` |
| `scripts/lib/{appendix-d,cve-facts,cve-fetch,cve-read-worker,cvelist-clone,git-source,kev-source}.ts` | dropped | CyberTracker's reference numbers, the CVE List clone and its workers, the advisory and KEV sources (SPEC §2) |
| `scripts/daily.sh` | later (P3) | Exactly as SPEC §8.2 shows it |
| `scripts/{daily,preflight,publish,recheck,build-context,agent-check}.ts` | later (P3) | The morning run with the Chinese pass, preflight, publish's commit forms, the rung watch and report intake, the contexts, `agent:check` for both passes |
| `scripts/{validate,gen-json-schema,chat}.ts` | later (P1) | |
| `scripts/{collect,metrics,backfill}.ts` | later (P2) | The backfill is rewritten for the Pace from 2015 (SPEC §8.4); `ledger-seed.ts` is new in P2 |
| `scripts/{color-check.ts,screenshots.mjs}` | later (P4) | |

## Routine (`routine/`)

| CyberTracker file | Verdict | What changed |
|---|---|---|
| `routine/STYLE.md` | later (P1) | Rewritten for this project; `STYLE-ZH.md` and `STYLE-METHOD-ZH.md` (P4) are new |
| `routine/schema/draft-brief.schema.json` | later (P1) | Generated from this project's schema; `draft-zh.schema.json` is new |
| `routine/TASK.md`, `routine/PROMPT.md`, `routine/REPAIR.md` | later (P3) | Rewritten (SPEC §11); `PROMPT-ZH.md` and `REPAIR-ZH.md` are new |
| `routine/agent-settings.json` | later (P3) | SPEC §9.5; `agent-settings-zh.json` is new |

## Site (`app/`, `components/`)

| CyberTracker file | Verdict | What changed |
|---|---|---|
| `app/{layout.tsx,globals.css,not-found.tsx,page.tsx}`, `app/{about,archive,methodology}/page.tsx`, `app/brief/[date]/page.tsx`, `app/feed.xml/route.ts` | later (P4) | The paper look in two root layouts, `app/(en)/` and `app/(zh)/zh/` (SPEC §6) |
| `app/items/[id]/page.tsx` | later (P4) | Becomes `findings/[id]` |
| `components/Markdown.tsx`, `components/layout/**`, `components/ui/{ExternalLink,PlainText,Tag,Counted}.tsx`, `components/charts/{parts.tsx,scale.ts,labels.ts}`, `components/pages/{archive-text,edition-meta,feed,labels,site-text,methodology-data}.ts`, `components/pages/ItemPage.tsx`, `components/brief/{BriefView,EditionMasthead,Lead,CorrectionBanner,CorrectionsList,Elsewhere,ItemCard,ItemDetails,ItemRow,brief-parts,item-parts,sources}.tsx`, `components/brief/props.ts` | later (P4) | The frame and the parts whose job is the same (SPEC §7) |
| `components/ui/{AIChip,SeverityPips}.tsx` | later (P4) | Become the AI-role chip and the significance pips |
| `components/brief/{ActorChips,AngleLine,EpssMovers,FixSideStrip,GapPanel,RegionRow,ScoreboardSection,TaiwanLens}.tsx`, `components/charts/{AiCreditedChart,FloodChart,WindowChart,WindowPeriods}.tsx` | dropped | CyberTracker's domain (SPEC §2); the Pace charts are new |

## Fixtures (`fixtures/`)

| CyberTracker folder | Verdict | What changed |
|---|---|---|
| `fixtures/src/` | later (P1) | The builder's pattern; every fixture is this project's own |
| `fixtures/{drafts,context,evidence,metrics,packs,site-content,empty-content,state,recheck}/` | later (P1 to P3) | Rebuilt with this project's data (SPEC §3) |
| `fixtures/injection/` | later (P1) | The planted page and RSS item and the canary's pack, context, evidence and metrics, written anew with this project's token (SPEC §10 P1), plus the Chinese pass's planted string |
| `fixtures/agent/` | later (P3) | `fake-claude.mjs` (for both passes), the three transcripts (their recorded folders renamed) and the pinned CLI's help (SPEC §10 P3) |
| `fixtures/agent/drafts/` | dropped | CyberTracker's pipeline drafts; P3 writes this project's |
| `fixtures/feeds/` | later (P2) | This project's scrubbed captures |
| `fixtures/{ai-credit,config,cvelist,cvelist-clone,reference,regions-input}/` | dropped | CyberTracker's data (`fixtures/config/` holds only the Scoreboard's sample `claims.json`, SPEC §2); P2 writes this project's `fixtures/reference/` and `fixtures/openalex/` |

## Tests (`tests/`)

| CyberTracker file | Verdict | What changed |
|---|---|---|
| `tests/setup/offline.ts` | copied | Comments and the guard's key; loaded from Foundation on |
| `tests/helpers/model-names.ts` | copied | Comment only |
| `tests/no-network.test.ts` | adapted | The `fetchFeed()` case returns in P2 |
| `tests/lib.test.ts` | adapted | Only the date cases, with this project's data cutoff, 13-week window and 260-week baseline, plus json cases; the URL, word-count and blocked-host cases return in P1 |
| `tests/run.test.ts` | adapted | The sample state file holds weekly counts; the advisory reader's case is dropped |
| `tests/git.test.ts` | adapted | `syncMain()` on a local bare remote, plus `ensureIdentity()`, `withRetry()`, `porcelainPaths()`, `onOriginMain()` and the deadline; six new `syncMain()` cases (a revert, a rename into the layout, a merge with `-s ours`, a local merge of origin's main, a merge's own change, an edit that follows a file origin moved); the publish cases return in P3 |
| `tests/lock.test.ts` | copied | The temporary folder's name |
| `tests/clock.test.ts` | adapted | This run's 03:15 start and 04:25 hard stop, and a check of the --no-deadline gaps |
| `tests/no-europe-strings.test.ts` | replaced | By `tests/no-cyber-strings.test.ts` (SPEC §10 Foundation step 6) |
| none | new | `tests/keychain.test.ts` (the service name and `readSecret()` with a stand-in tool) and `tests/repo-files.test.ts` (the files SPEC.md shows, the registry's format, the error-report form, the PR template) |
| `tests/helpers/{harness,pipeline-world,publish-world,stale-cases}.ts`, `tests/{agent,agent-check,daily,data-only,deploy,fake-agent,harness,links,p3-contract,pipeline-draft,preflight,prompts,prune,publish,recheck,status,transcript,validate-loop,apply,context}.test.ts` | later (P3) | With the code they test |
| `tests/{chat,config,fixtures,fixtures-base,fixture-safety,helpers,json-schema,page-text,rules-meta-items,rules-words-sources,rules-naming-safety-computed,sanitize,schema,shared,style,validate,validate-engine}.test.ts` | later (P1) | With the code they test; the CVE, victim and exploit cases dropped; `fixture-safety` scans P1's folders. A case that imports a module copied later joins its test in that phase: `shared`'s cases of `lib/feeds/cache.ts` and `lib/feeds/types.ts`, and `fixture-safety`'s checks that import `fixtures/src/scrub-feed`, in P2. A case that imports a dropped module goes with it, such as the zip cases of `fixture-safety` and `fixtures-base`, the Gap headline cases of `page-text` and `rules-naming-safety-computed` and the reference cases of `page-text`, and the withholding and Scoreboard cases of `validate`, `validate-engine` and `config`. The early copies (`lib/site.ts`, `lib/content.ts` and the `lib/apply.ts` helpers, above) load in P1 |
| `tests/{backfill,captures,collect,compute-metrics,contract,evidence,feed-readers,feeds,fixtures-state,http,metrics,metrics-script,rank,reference,snapshot,sources-check}.test.ts` | later (P2) | With the code they test (`contract` lists this project's P2 modules and constants; the transcript cases of `evidence.test.ts` in P3) |
| `tests/{content,site,stale,color-check,screenshots}.test.ts(x)` | later (P4) | With the code they test; `content`'s cases of `loadContent()` and `SITE_BLOCKING_CODES` come in P1 with `lib/content.ts` |
| `tests/{ai-credit,angle-numbers,fix-side,flood,regions,registry,rules-cves-grounding-ai,series,window,withhold}.test.ts`, `tests/helpers/{d6,fixture-clone,zip}.ts` | dropped | CyberTracker's domain; P1 writes this project's rule tests and P2 its registry test |
