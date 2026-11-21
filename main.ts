// main.ts — Sokoban solver for make.fun sokoban-solver-01-run-20261121.
//
// How the levels are built (from the competition rules): every level is a
// hallway one square wide across the board, where the player starts, plus
// one to four rooms off it, each in a 6 by 6 slot opening onto the hallway
// through one door, holding 3 or 4 boxes and as many goals. A box pushed
// through a door into the hallway can never be pushed back, so every box
// stays in its room, and the level's push-optimal count P* is the sum of
// the rooms' optima. So this solver:
//
//   1. splits a level into its hallway and rooms (flood fill, excluding
//      the hallway row; each room's door is its one square touching the
//      hallway),
//   2. solves each room on its own with a push-optimal macro-push BFS
//      (the state is the boxes plus the player's reachable region; dead
//      squares are found by reverse-pull analysis and 2x2 frozen blocks
//      are pruned), once for the plain optimum and once with the extra
//      condition that the player can still walk out of the door,
//   3. orders the rooms so the one whose exit costs the most pushes goes
//      last (it needs no exit), and stitches the room solutions together
//      with shortest walks along the hallway.
//
// No clock is read and nothing is random: the same input always gives the
// same bytes. Only Node built-ins are used. Plain JavaScript in a .ts
// file, so Node 22 runs it as it is.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Work cap per room search, counted in state expansions, never in seconds:
// a search that blows past it is abandoned so one bad room cannot eat the
// whole 60 second wall for the set.
const MAX_EXPANSIONS = 3000000;

const DIRS = [
  { dx: 0, dy: -1, ch: 'u' },
  { dx: 0, dy: 1, ch: 'd' },
  { dx: -1, dy: 0, ch: 'l' },
  { dx: 1, dy: 0, ch: 'r' },
];

/** Parse an XSB level: walls, goals, boxes and the player. */
function parseLevel(text) {
  const rows = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((r) => r.length > 0);
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const wall = new Uint8Array(w * h).fill(1);
  const goal = new Uint8Array(w * h);
  const boxes = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goal[i] = 1;
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  return { w, h, wall, goal, boxes, player };
}

/**
 * Split a level into its hallway row and its rooms. A room is a connected
 * component of floor squares off the hallway row; its door is its one
 * square touching a hallway floor square, and its entry is that hallway
 * square (where the player stands to come in).
 */
function decompose(level) {
  const { w, h, wall, goal, boxes, player } = level;
  const H = Math.floor(player / w);
  const inHallway = (i) => Math.floor(i / w) === H;
  const seen = new Uint8Array(w * h);
  const rooms = [];
  for (let i = 0; i < w * h; i++) {
    if (wall[i] || inHallway(i) || seen[i]) continue;
    const comp = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop();
      comp.push(c);
      const x = c % w;
      const y = Math.floor(c / w);
      for (const d of DIRS) {
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (wall[n] || inHallway(n) || seen[n]) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    const compSet = new Set(comp);
    let door = -1;
    let entry = -1;
    for (const c of comp) {
      const x = c % w;
      const y = Math.floor(c / w);
      for (const d of DIRS) {
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (ny !== H || nx < 0 || nx >= w) continue;
        const n = ny * w + nx;
        if (!wall[n]) {
          door = c;
          entry = n;
        }
      }
    }
    rooms.push({
      squares: comp,
      squareSet: compSet,
      door,
      entry,
      boxes: boxes.filter((b) => compSet.has(b)),
      goals: comp.filter((c) => goal[c] === 1),
    });
  }
  return { H, rooms };
}

/** Shortest walk (u/d/l/r) over free squares, or null when unreachable. */
function walkLevel(level, boxes, from, to) {
  const { w, h, wall } = level;
  const blocked = new Uint8Array(w * h);
  for (const b of boxes) blocked[b] = 1;
  const prev = new Int32Array(w * h).fill(-2);
  const prevDir = new Int8Array(w * h).fill(-1);
  const q = [from];
  prev[from] = -1;
  for (let head = 0; head < q.length; head++) {
    const c = q[head];
    if (c === to) break;
    const x = c % w;
    const y = Math.floor(c / w);
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d].dx;
      const ny = y + DIRS[d].dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nb = ny * w + nx;
      if (wall[nb] || blocked[nb] || prev[nb] !== -2) continue;
      prev[nb] = c;
      prevDir[nb] = d;
      q.push(nb);
    }
  }
  if (prev[to] === -2) return null;
  let s = '';
  let c = to;
  while (c !== from) {
    s = DIRS[prevDir[c]].ch + s;
    c = prev[c];
  }
  return s;
}

/**
 * Solve one room on its own, push-optimally, with a macro-push BFS.
 * The player starts on the entry square (in the hallway, by the door).
 * Returns { unOpt, exOpt }: the plain optimum and the optimum with the
 * extra condition that the player can still walk out to the entry when
 * the room is solved (null when no such solution exists). Each is
 * { moves, pushes, endPlayer, finalBoxes } with grid indices, or null.
 */
function solveRoom(room, level) {
  const { w, h, wall, goal } = level;
  const sq = room.squares;
  const n = sq.length;
  const ENTRY = n;
  const loc = new Map();
  sq.forEach((g, i) => loc.set(g, i));
  const entryGrid = room.entry;

  // Local neighbours: neigh[i][d] is the local index of the square in
  // direction d from local square i (room squares 0..n-1, ENTRY = n),
  // or -1 for a wall or a hallway square other than the entry.
  const neigh = [];
  const localOf = (gx, gy) => {
    if (gx < 0 || gy < 0 || gx >= w || gy >= h) return -1;
    const g = gy * w + gx;
    if (g === entryGrid) return ENTRY;
    const li = loc.get(g);
    return li === undefined ? -1 : li;
  };
  for (let i = 0; i < n; i++) {
    const g = sq[i];
    const x = g % w;
    const y = Math.floor(g / w);
    neigh[i] = DIRS.map((d) => localOf(x + d.dx, y + d.dy));
  }
  {
    const x = entryGrid % w;
    const y = Math.floor(entryGrid / w);
    neigh[ENTRY] = DIRS.map((d) => localOf(x + d.dx, y + d.dy));
  }

  // Dead squares by reverse-pull analysis: a square is live when a box on
  // it can be pushed onto a goal, ignoring other boxes. From a live square
  // t, the square s = t - d is live when the player can stand at s - d.
  const isGoalLocal = new Uint8Array(n + 1);
  for (const g of room.goals) isGoalLocal[loc.get(g)] = 1;
  const live = new Uint8Array(n + 1);
  const work = [];
  for (let i = 0; i < n; i++) {
    if (isGoalLocal[i]) {
      live[i] = 1;
      work.push(i);
    }
  }
  while (work.length) {
    const t = work.pop();
    for (let d = 0; d < 4; d++) {
      const s = neigh[t][d ^ 1];
      if (s < 0 || s >= n || live[s]) continue;
      const stand = neigh[s][d ^ 1];
      if (stand < 0) continue;
      live[s] = 1;
      work.push(s);
    }
  }

  const startBoxes = room.boxes.map((g) => loc.get(g)).sort((a, b) => a - b);

  // Flood fill from the player over room squares plus the entry, with the
  // boxes as obstacles. Returns the reachable set and its bit mask.
  function reachable(boxes, player) {
    const blocked = new Uint8Array(n + 1);
    for (const b of boxes) blocked[b] = 1;
    const set = new Uint8Array(n + 1);
    const stack = [player];
    set[player] = 1;
    let mask = 0n;
    while (stack.length) {
      const c = stack.pop();
      mask |= 1n << BigInt(c);
      for (let d = 0; d < 4; d++) {
        const nb = neigh[c][d];
        if (nb < 0 || blocked[nb] || set[nb]) continue;
        set[nb] = 1;
        stack.push(nb);
      }
    }
    return { set, mask };
  }

  // A 2x2 block of walls and boxes with no goal in it freezes every box
  // in it: each of its boxes has a wall or box on every side it could be
  // pushed to or pushed from. True when the moved box lands in one.
  function frozen22(targetGrid, newBoxesGrid) {
    const boxSet = new Set(newBoxesGrid);
    const tx = targetGrid % w;
    const ty = Math.floor(targetGrid / w);
    for (let ox = -1; ox <= 0; ox++) {
      for (let oy = -1; oy <= 0; oy++) {
        let allBlocked = true;
        let hasBox = false;
        let hasGoal = false;
        for (let dx = 0; dx < 2; dx++) {
          for (let dy = 0; dy < 2; dy++) {
            const gx = tx + ox + dx;
            const gy = ty + oy + dy;
            if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue; // wall
            const g = gy * w + gx;
            if (goal[g]) hasGoal = true;
            if (boxSet.has(g)) hasBox = true;
            else if (wall[g]) {
              // wall: blocked
            } else {
              allBlocked = false;
            }
          }
        }
        if (allBlocked && hasBox && !hasGoal) return true;
      }
    }
    return false;
  }

  const solved = (boxes) => boxes.every((b) => isGoalLocal[b] === 1);
  const packBoxes = (boxes) => {
    let p = 0;
    for (let k = 0; k < 4; k++) {
      const b = k < boxes.length ? boxes[k] : 63;
      p |= b << (6 * k);
    }
    return p;
  };

  // BFS over (boxes, player region). States keep parent links so the
  // move string can be rebuilt; the walk for each push is recomputed
  // from the parent state when rebuilding. The reachable set is computed
  // once per state, when it is created, and reused when it is expanded.
  const states = [];
  const index = new Map();
  function addState(boxes, player, parent, fromBox, dir, depth) {
    const reach = reachable(boxes, player);
    const key = (BigInt(packBoxes(boxes)) << 40n) | reach.mask;
    if (index.has(key)) return -1;
    const id = states.length;
    states.push({ boxes, player, parent, fromBox, dir, depth, reachSet: reach.set });
    index.set(key, id);
    return id;
  }
  const startId = addState(startBoxes, ENTRY, -1, -1, -1, 0);
  const queue = [startId];
  let head = 0;
  let expansions = 0;
  let unOpt = null;
  let exOpt = null;

  while (head < queue.length) {
    if (expansions++ > MAX_EXPANSIONS) return { unOpt, exOpt };
    const id = queue[head++];
    const st = states[id];
    const reach = st.reachSet;
    for (const b of st.boxes) {
      for (let d = 0; d < 4; d++) {
        const behind = neigh[b][d ^ 1];
        if (behind < 0 || !reach[behind]) continue;
        const target = neigh[b][d];
        if (target < 0 || target >= n) continue; // boxes stay in the room
        if (st.boxes.includes(target)) continue;
        if (!live[target]) continue; // dead square: can never reach a goal
        const nb = [...st.boxes];
        nb[nb.indexOf(b)] = target;
        nb.sort((a, b2) => a - b2);
        const nbGrid = nb.map((x) => sq[x]);
        if (frozen22(sq[target], nbGrid)) continue;
        const nid = addState(nb, b, id, b, d, st.depth + 1);
        if (nid < 0) continue;
        queue.push(nid);
        if (solved(nb)) {
          if (unOpt === null) unOpt = { id: nid, pushes: st.depth + 1 };
          if (exOpt === null && states[nid].reachSet[ENTRY]) {
            exOpt = { id: nid, pushes: st.depth + 1 };
          }
          if (unOpt !== null && exOpt !== null) {
            head = queue.length; // stop: both optima are found
            break;
          }
        }
      }
      if (unOpt !== null && exOpt !== null) break;
    }
  }

  // Rebuild the move string for a goal state: for each push, the walk
  // from the parent's player square to the square behind the box, then
  // the push itself.
  function rebuild(goalId) {
    const chain = [];
    let id = goalId;
    while (states[id].parent >= 0) {
      chain.push(states[id]);
      id = states[id].parent;
    }
    chain.reverse();
    let moves = '';
    for (const t of chain) {
      const parent = states[t.parent];
      const behind = neigh[t.fromBox][t.dir ^ 1];
      const walk = walkInRoom(parent.boxes, parent.player, behind);
      if (walk === null) return null;
      moves += walk + DIRS[t.dir].ch;
    }
    const goal = states[goalId];
    return {
      moves,
      pushes: goal.depth,
      endPlayer: goal.player >= n ? entryGrid : sq[goal.player],
      finalBoxes: goal.boxes.map((x) => sq[x]),
    };
  }

  function walkInRoom(boxes, from, to) {
    const blocked = new Uint8Array(n + 1);
    for (const b of boxes) blocked[b] = 1;
    const prev = new Int32Array(n + 1).fill(-2);
    const prevDir = new Int8Array(n + 1).fill(-1);
    const q = [from];
    prev[from] = -1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      if (c === to) break;
      for (let d = 0; d < 4; d++) {
        const nb = neigh[c][d];
        if (nb < 0 || blocked[nb] || prev[nb] !== -2) continue;
        prev[nb] = c;
        prevDir[nb] = d;
        q.push(nb);
      }
    }
    if (prev[to] === -2) return null;
    let s = '';
    let c = to;
    while (c !== from) {
      s = DIRS[prevDir[c]].ch + s;
      c = prev[c];
    }
    return s;
  }

  return {
    unOpt: unOpt === null ? null : rebuild(unOpt.id),
    exOpt: exOpt === null ? null : rebuild(exOpt.id),
  };
}

/** All orderings of 0..n-1. */
function permutations(n) {
  const out = [];
  const a = [...Array(n).keys()];
  const gen = (k) => {
    if (k === 1) {
      out.push([...a]);
      return;
    }
    for (let i = 0; i < k; i++) {
      gen(k - 1);
      const j = k % 2 === 1 ? 0 : i;
      [a[j], a[k - 1]] = [a[k - 1], a[j]];
    }
  };
  gen(n);
  return out;
}

/** Solve one whole level: order the rooms, walk between them, solve each. */
function solveLevel(level) {
  const { rooms } = decompose(level);
  if (rooms.length === 0) return '';
  const infos = rooms.map((r) => solveRoom(r, level));
  if (infos.some((inf) => inf.unOpt === null)) return '';
  // Try every room order; the last room needs no exit, the others do.
  // Pick the valid order with the fewest total pushes.
  let best = null;
  for (const order of permutations(rooms.length)) {
    let total = 0;
    let ok = true;
    for (let k = 0; k < order.length; k++) {
      const inf = infos[order[k]];
      const use = k === order.length - 1 ? inf.unOpt : inf.exOpt;
      if (use === null) {
        ok = false;
        break;
      }
      total += use.pushes;
    }
    if (ok && (best === null || total < best.total)) best = { order, total };
  }
  if (best === null) return '';
  let moves = '';
  let player = level.player;
  let boxes = [...level.boxes];
  for (let k = 0; k < best.order.length; k++) {
    const i = best.order[k];
    const last = k === best.order.length - 1;
    const use = last ? infos[i].unOpt : infos[i].exOpt;
    const w1 = walkLevel(level, boxes, player, rooms[i].entry);
    if (w1 === null) return '';
    moves += w1;
    player = rooms[i].entry;
    moves += use.moves;
    player = use.endPlayer;
    const roomBoxSet = new Set(rooms[i].boxes);
    boxes = boxes.filter((b) => !roomBoxSet.has(b)).concat(use.finalBoxes);
  }
  return moves;
}

for (const id of readdirSync(INPUT_DIR).sort()) {
  let moves = '';
  try {
    moves = solveLevel(parseLevel(readFileSync(join(INPUT_DIR, id, 'level.txt'), 'utf8')));
  } catch {
    moves = '';
  }
  mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
  writeFileSync(join(OUTPUT_DIR, id, 'solution.txt'), `${moves}\n`);
}
