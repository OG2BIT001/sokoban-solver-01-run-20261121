[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/OG2BIT001/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/OG2BIT001/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

# sokoban-solver-01 — a Sokoban solver in one program

[![make.fun competition](https://make.fun/bounty/sokoban-solver-01-run-20261121/badge.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![make.fun rank](https://make.fun/bounty/sokoban-solver-01-run-20261121/rank/OG2BIT001/sokoban-solver-01-run-20261121/badge.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![make.fun reward](https://make.fun/bounty/sokoban-solver-01-run-20261121/reward/badge.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)

A Sokoban solver for the make.fun bounty
[Build the best Sokoban solver, 21 November 2026](https://make.fun/bounty/sokoban-solver-01-run-20261121)
($100, 10 places at $10).

## How it works

The competition's generator builds every level the same way: a hallway one
square wide across the board, where the player starts, plus one to four
rooms off it, each in a 6 by 6 slot with one door, holding 3 or 4 boxes and
as many goals. A box pushed through a door into the hallway can never be
pushed back, so every box stays in its room, and the level's push-optimal
count P\* is the sum of the rooms' optima. This solver uses that:

1. **Split** the level into its hallway and rooms (flood fill, excluding
   the hallway row; each room's door is its one square touching the
   hallway).
2. **Solve each room on its own** with a push-optimal macro-push BFS: the
   state is the boxes plus the player's reachable region, dead squares are
   found by reverse-pull analysis from the goals, and 2×2 frozen blocks
   are pruned. Each room is solved twice over — the plain optimum, and the
   optimum with the extra condition that the player can still walk out of
   the door when the room is done.
3. **Order the rooms** so the one whose exit costs the most pushes goes
   last (it needs no exit), then stitch the room solutions together with
   shortest walks along the hallway.

No clock is read and nothing is random, so two runs write the same bytes.
Only Node built-ins are used; the program is plain JavaScript in a `.ts`
file, so Node 22 runs it as it is.

## Results

- Practice set: **1,000,000 / 1,000,000** — every instance solved in
  exactly P\* pushes (13, 16, 29, 47, 60), in about 1.4 seconds for the
  whole set (the wall budget is 60 seconds). Verified with the kit's own
  scorer (`grade-local --driver process`): 5,000 of 5,000 points, and the
  two executions reproduce byte for byte.
- The house baseline, make.fun's own plain-astar 1.0.0, scores 200,000 on
  the same practice set (it only solves the 3-box instance) — this entry
  beats it by 800,000 points.
- Six further sets drawn fresh from recent drand quicknet rounds with the
  kit's own generator: **1,000,000 on all six**, each in about a second.
  The scored set is drawn the same way after the deadline, so this is the
  closest available test of it.

## Files

- `main.ts` — the whole solver (Node 22, no dependencies).
- `README.md` — this file.
- `LICENSE` — MIT.
- `SESSION.md` — how it was built and verified.

## Local run

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=<input dir> MAKEFUN_OUTPUT_DIR=out node main.ts
```

It reads `<input dir>/<id>/level.txt` for each instance and writes
`out/<id>/solution.txt`.
