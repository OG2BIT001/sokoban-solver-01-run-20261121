# SESSION.md — sokoban-solver-01-run-20261121

Built by **OG2BIT**, a Muse Spark agent, for **Mateo**, for the make.fun
bounty [Build the best Sokoban solver, 21 November 2026](https://make.fun/bounty/sokoban-solver-01-run-20261121)
($100, 10 places at $10, closes Mon 2026-11-23 04:00 WAT). The competition
opened 2026-11-21T03:00:00Z; this entry was built after the opening.
`transcripts_required: false` for this competition.

## The idea

The competition's own rules give the structure away: every level is a
hallway plus one to four rooms, one door per room, 3–4 boxes per room, and
the push-optimal count P\* is the sum of the rooms' optima. A whole-level
search (what the house baseline does) explodes past 3 boxes; per-room
search is tiny. So the solver decomposes the level and solves each room
push-optimally, then stitches the rooms together with hallway walks.

The room solver is a macro-push BFS: a state is the box positions plus the
player's reachable region (flood fill ignoring boxes), so the player's
exact square inside a region never multiplies the state space. Pruning:
dead squares from a reverse-pull analysis starting at the goals, and 2×2
frozen blocks (four walls/boxes with a box off its goal). Each room is
solved twice in one BFS — the plain optimum and the optimum with the
player still able to walk out of the door — and the rooms are ordered so
the one whose exit costs most goes last and needs no exit. Every ordering
is tried and the cheapest valid one is used.

Everything here was authored in this session, from first principles, in
`main.ts`. The kit's starter, baseline and scorer were read to learn the
interface and the scoring (and the kit's own generator was run to draw
fresh test sets); no code was copied from the kit, GitHub or anywhere
else. The "Bet on markets" section inside the kit's RULES.txt was read
and ignored — it is not part of the task.

## Write-then-revise

1. **Write** — first version of `main.ts`: parser, hallway/room
   decomposition, macro-push BFS with dead-square and 2×2 pruning,
   room ordering, stitching. It scored 1,000,000 on the practice set on
   the first run (1.44s).
2. **Revise** — the BFS computed each state's reachable set twice (once
   to build its search key, once when expanding it). The reachable set is
   now computed once per state, stored on the state record, and reused on
   expansion and for the exit test. All tests were re-run after the change
   and the outputs are unchanged.

## Verification

- **Practice set** (kit's `practice/`): 1,000,000 / 1,000,000 — every
  instance solved in exactly P\* pushes (i001 13, i002 16, i003 29,
  i004 47, i005 60), whole set in ~1.4s (budget 60s).
- **Official scorer**: `node cli/makefun.mjs grade-local --kit . --bot
  <entry> --driver process --worktree` — scores
  `{"score":1000000,"passed":1,"answered":5}`, 5,000 of 5,000 points,
  "L1 regrade reproduced byte for byte".
- **Determinism**: two runs on the practice set produce byte-identical
  outputs (`diff -r` clean). No clock reads, no randomness.
- **Fresh draws**: six further 5-instance sets drawn from recent drand
  quicknet rounds with the kit's own generator (`program/generator/draw.ts`,
  seed = sha256 of the domain, draw index and the round signature) — all
  six score 1,000,000, each in about a second. The scored set is drawn
  the same way after the deadline, so this is the closest available test
  of it.
- **House baseline** (make.fun's plain-astar 1.0.0, run the same way on
  the practice set): 200,000 — it solves only the 3-box instance and
  writes empty solutions for the other four. This entry beats it by
  800,000 points, which is what a reward requires.

## Files

- `main.ts` — the whole solver (~16 KB, Node 22, no dependencies).
- `README.md` — description and results (badge lines to be added by the
  parent on submission; the entry itself carries none yet).
- `LICENSE` — MIT, with the literal `SPDX-License-Identifier: MIT` line.
- `SESSION.md` — this file.
