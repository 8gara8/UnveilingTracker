# Unveiling Tracker

What AI is helping us discover, explained.

A daily morning brief, on Taipei time, on what AI is helping humanity discover in science, mathematics,
the social sciences, theology and the humanities. Each finding is explained in plain words, linked to its
primary sources and marked with how sure we are, in English and Traditional Chinese.

Status: being built, in phases (SPEC.md §10). Foundation, the repository's scaffolding forked from
CyberTracker's machinery, is in review; the first brief follows the supervised go-live in P5.

- Design: [docs/DESIGN.md](docs/DESIGN.md) (settled v0.4, frozen)
- Build spec: [SPEC.md](SPEC.md)
- Agent guide: [AGENTS.md](AGENTS.md)
- What came from CyberTracker: [docs/PROVENANCE.md](docs/PROVENANCE.md)

Data credits: every source's terms and credit line will be listed in `docs/SOURCES.md` when the feeds
arrive (P2).

Commands (Node from `/opt/homebrew/bin` on Kobol; SPEC.md §8.1 has the full list as it grows):

- `npm ci`: install the pinned dependencies
- `npm run check`: what CI runs, before every push
