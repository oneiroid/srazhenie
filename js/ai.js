// Компьютерный соперник. Видит только то, что видел бы игрок: свои фишки, расположение чужих,
// какие из них уже ходили, и звания, раскрытые в боях.
import {
  RANKS, RANK, MINE, FLAG, SIZE, isMovable, resolve, neighbors, homeCells, depth, rowOf, colOf, idx, WHITE,
} from './rules.js';

const val = r => RANK[r].value;

// ---------- Расстановка ----------

const DEPTH_W = {
  1: [1, 2, 2, 1], 2: [1, 2, 2, 1], 3: [1.5, 2, 1.5, .6], 4: [2, 2, 1, .6], 5: [2, 1.5, 1, .7],
  6: [2, 1.5, 1, .7], 7: [2, 1.5, 1, 1], 8: [.4, 1, 2, 2], 9: [3, 1.5, 1, 1], 10: [.5, 2, 2, 1],
  [MINE]: [.3, 1, 1.5, 1.5],
};

function pickWeighted(items, weight, rng) {
  const ws = items.map(weight);
  const sum = ws.reduce((a, b) => a + b, 0);
  let x = rng() * sum;
  for (let k = 0; k < items.length; k++) if ((x -= ws[k]) <= 0) return items[k];
  return items[items.length - 1];
}

export function aiLayout(owner, rng = Math.random) {
  const free = new Set(homeCells(owner));
  const out = [];
  const put = (cell, rank) => { free.delete(cell); out.push([cell, rank]); };
  const freeAt = d => [...free].filter(c => depth(owner, c) === d);

  // Знамя — в заднем ряду (иногда во втором), вокруг — мины.
  const flagRow = rng() < .85 ? 3 : 2;
  const flag = pickWeighted(freeAt(flagRow), () => 1, rng);
  put(flag, FLAG);
  let mines = RANK[MINE].count;
  const around = neighbors(flag).filter(c => free.has(c));
  for (const c of around) if (mines > 0 && rng() < .85) { put(c, MINE); mines--; }
  while (mines-- > 0) put(pickWeighted([...free], c => DEPTH_W[MINE][depth(owner, c)], rng), MINE);

  const order = [1, 2, 10, 3, 3, 8, 8, 8, 8, 8];
  const rest = [];
  for (const r of RANKS) {
    if (r.id === MINE || r.id === FLAG) continue;
    const used = order.filter(x => x === r.id).length;
    for (let k = used; k < r.count; k++) rest.push(r.id);
  }
  for (let k = rest.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [rest[k], rest[j]] = [rest[j], rest[k]];
  }
  for (const rank of [...order, ...rest]) {
    put(pickWeighted([...free], c => DEPTH_W[rank][depth(owner, c)], rng), rank);
  }
  return out;
}

// ---------- Модель знаний о сопернике ----------

function knowledge(game, me) {
  const opp = 1 - me;
  const unknown = Object.fromEntries(RANKS.map(r => [r.id, r.count]));
  for (const p of game.pieces) if (p.owner === opp && p.revealed) unknown[p.rank]--;
  const hidden = game.pieces.filter(p => p.owner === opp && p.alive && !p.revealed);
  const movedHidden = hidden.filter(p => p.moved).length;
  let movUnknown = 0;
  for (const r of RANKS) if (isMovable(r.id)) movUnknown += unknown[r.id];
  const poolScale = movUnknown > 0 ? Math.max(0, movUnknown - movedHidden) / movUnknown : 0;
  const mineBias = [.6, 1, 1.2, 1.2], flagBias = [.1, .4, 1.2, 3];

  const dist = new Map();
  for (const p of game.pieces) {
    if (p.owner !== opp || !p.alive) continue;
    const d = {};
    if (p.revealed) {
      d[p.rank] = 1;
    } else {
      const dp = Math.max(0, Math.min(3, depth(opp, p.pos)));
      let sum = 0;
      for (const r of RANKS) {
        let w;
        if (isMovable(r.id)) w = unknown[r.id] * (p.moved ? 1 : poolScale);
        else if (p.moved) w = 0;
        else w = unknown[r.id] * (r.id === MINE ? mineBias[dp] : flagBias[dp]);
        if (w > 0) { d[r.id] = w; sum += w; }
      }
      for (const k in d) d[k] /= sum;
    }
    dist.set(p.id, d);
  }
  return dist;
}

// Ожидаемый результат атаки фишкой ранга att на фишку с распределением d.
function attackEV(att, d, flagValue) {
  let ev = 0;
  for (const k in d) {
    const r = +k, pr = d[k];
    const res = resolve(att, r);
    if (res === 'att') ev += pr * (r === FLAG ? flagValue : val(r));
    else if (res === 'def') ev -= pr * val(att);
    else ev += pr * (val(r) - val(att));
  }
  return ev;
}

// Вероятность, что фишка с распределением d побьёт нашу фишку ранга mine, напав на неё.
function beatProb(d, mine) {
  let p = 0, movable = 0;
  for (const k in d) {
    if (!isMovable(+k)) continue;
    movable += d[k];
    if (resolve(+k, mine) === 'att') p += d[k];
  }
  return movable > 0 ? p / movable * Math.min(1, movable * 1.5) : 0;
}

function danger(game, dist, piece, pos, ignoreId) {
  let worst = 0;
  for (const n of neighbors(pos)) {
    const e = game.at(n);
    if (!e || e.owner === piece.owner || e.id === ignoreId) continue;
    worst = Math.max(worst, beatProb(dist.get(e.id), piece.rank));
  }
  return worst * val(piece.rank) * (piece.revealed ? .9 : .5);
}

// ---------- Выбор хода ----------

export function aiMove(game, me, level = 'normal', rng = Math.random) {
  const moves = game.legalMoves(me);
  if (!moves.length) return null;
  const dist = knowledge(game, me);
  const fwd = me === WHITE ? -1 : 1;
  const myFlag = game.pieces.find(p => p.owner === me && p.alive && p.rank === FLAG);
  const stall = Math.min(1, game.sinceBattle / 60);
  const noise = level === 'easy' ? 2.5 : .2;
  const last = [...game.history].reverse().find(h => h.owner === me);

  let best = null, bestScore = -Infinity;
  for (const [from, to] of moves) {
    const p = game.at(from), q = game.at(to);
    let s = 0;
    if (q) {
      const d = dist.get(q.id);
      s += attackEV(p.rank, d, 200);
      if (!q.revealed) s += .3;
      if (!p.revealed) s -= val(p.rank) * .08;
      // Если победим — останемся на клетке to.
      const pWin = Object.entries(d).reduce((a, [r, pr]) => a + (resolve(p.rank, +r) === 'att' ? pr : 0), 0);
      if (level !== 'easy') s -= pWin * danger(game, dist, p, to, q.id);
      if (myFlag && Math.abs(rowOf(q.pos) - rowOf(myFlag.pos)) + Math.abs(colOf(q.pos) - colOf(myFlag.pos)) <= 2) s += 3;
    } else {
      const adv = (rowOf(to) - rowOf(from)) * fwd;
      const weak = p.rank >= 7 ? 1 : .4;
      s += adv * (.12 * weak + .25 * stall);
      // Боковое движение к центру проходов немного полезно.
      s += (Math.abs(colOf(from) - 4.5) - Math.abs(colOf(to) - 4.5)) * .02;
      if (level !== 'easy') {
        s += danger(game, dist, p, from) - danger(game, dist, p, to);
        // Угроза: рядом окажется слабая известная фишка соперника.
        let threat = 0;
        for (const n of neighbors(to)) {
          const e = game.at(n);
          if (e && e.owner !== me) threat = Math.max(threat, attackEV(p.rank, dist.get(e.id), 200));
        }
        s += Math.max(0, threat) * .3;
      }
      if (last && last.id === p.id && last.from === to) s -= .5;
    }
    // Дорогие фишки не выходят вперёд без нужды.
    if (p.rank <= 2 && !q) s -= .1;
    s += (rng() - .5) * noise;
    if (s > bestScore) { bestScore = s; best = [from, to]; }
  }
  return best;
}
