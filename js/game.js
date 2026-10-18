// Состояние партии. Один и тот же класс используется для игры на одном устройстве, против компьютера
// и по сети; в сетевой партии звания фишек соперника неизвестны (rank === null) до их раскрытия в бою.
import {
  SIZE, WHITE, BLUE, FLAG, ARMY_SIZE, MAX_SHUTTLE, NO_BATTLE_DRAW,
  neighbors, isMovable, resolve, inHomeRows, armyList,
} from './rules.js';

export class Game {
  constructor(data) {
    if (data) {
      Object.assign(this, structuredClone(data));
    } else {
      this.pieces = [];
      for (const owner of [WHITE, BLUE]) {
        for (let k = 0; k < ARMY_SIZE; k++) {
          this.pieces.push({ id: owner * ARMY_SIZE + k, owner, rank: null, pos: -1, alive: true, revealed: false, moved: false });
        }
      }
      this.turn = WHITE;
      this.phase = 'setup';
      this.winner = null;
      this.reason = '';
      this.history = [];
      this.sinceBattle = 0;
    }
    this.rebuild();
  }

  toJSON() {
    const { board, ...rest } = this;
    return rest;
  }

  rebuild() {
    this.board = new Array(SIZE * SIZE).fill(-1);
    for (const p of this.pieces) if (p.alive && p.pos >= 0) this.board[p.pos] = p.id;
  }

  at(i) {
    const id = this.board[i];
    return id >= 0 ? this.pieces[id] : null;
  }

  army(owner) {
    return this.pieces.filter(p => p.owner === owner);
  }

  // layout: массив [клетка, звание] на 40 фишек своей армии.
  placeArmy(owner, layout) {
    const army = this.army(owner);
    layout.forEach(([pos, rank], k) => {
      if (!inHomeRows(owner, pos)) throw new Error('bad setup cell');
      Object.assign(army[k], { pos, rank, alive: true });
    });
    this.rebuild();
  }

  // Расстановка соперника без званий (сетевая партия): ids → клетки.
  placeHidden(owner, positions) {
    for (const [id, pos] of Object.entries(positions)) {
      const p = this.pieces[+id];
      if (p.owner !== owner || !inHomeRows(owner, pos)) throw new Error('bad setup');
      p.pos = pos;
    }
    this.rebuild();
  }

  start() {
    this.phase = 'play';
    this.turn = WHITE;
  }

  // Ход назад-вперёд между двумя клетками больше MAX_SHUTTLE раз подряд запрещён.
  shuttleBlocked(owner, id, from, to) {
    const mine = [];
    for (let k = this.history.length - 1; k >= 0 && mine.length < MAX_SHUTTLE; k--) {
      if (this.history[k].owner === owner) mine.push(this.history[k]);
    }
    if (mine.length < MAX_SHUTTLE) return false;
    // mine[0] — последний ход. Нужна цепочка: ... to→from, from→to, to→from, и теперь from→to.
    let a = to, b = from;
    for (const m of mine) {
      if (m.id !== id || m.from !== a || m.to !== b) return false;
      [a, b] = [b, a];
    }
    return true;
  }

  movesFrom(i) {
    const p = this.at(i);
    if (!p || !isMovable(p.rank)) return [];
    const out = [];
    for (const n of neighbors(i)) {
      const q = this.at(n);
      if (q && q.owner === p.owner) continue;
      if (this.shuttleBlocked(p.owner, p.id, i, n)) continue;
      out.push(n);
    }
    return out;
  }

  legalMoves(owner) {
    const out = [];
    for (const p of this.pieces) {
      if (p.owner !== owner || !p.alive) continue;
      for (const to of this.movesFrom(p.pos)) out.push([p.pos, to]);
    }
    return out;
  }

  isAttack(from, to) {
    const p = this.at(from), q = this.at(to);
    return !!(p && q && q.owner !== p.owner);
  }

  // Выполнить ход. Для атаки звания обеих фишек должны быть известны (или переданы в ranks).
  // Возвращает событие для анимации.
  move(from, to, ranks = {}) {
    if (this.phase !== 'play') throw new Error('game not in play');
    const p = this.at(from);
    if (!p || p.owner !== this.turn) throw new Error('not your piece');
    const q = this.at(to);
    const ev = { owner: p.owner, id: p.id, from, to };
    p.moved = true;
    if (!q) {
      p.pos = to;
      this.board[from] = -1;
      this.board[to] = p.id;
      this.sinceBattle++;
    } else {
      if (ranks.att != null) p.rank = ranks.att;
      if (ranks.def != null) q.rank = ranks.def;
      if (p.rank == null || q.rank == null) throw new Error('ranks unknown');
      const result = resolve(p.rank, q.rank);
      ev.battle = { attId: p.id, defId: q.id, attRank: p.rank, defRank: q.rank, result };
      p.revealed = q.revealed = true;
      this.board[from] = -1;
      if (result === 'att') {
        q.alive = false;
        p.pos = to;
        this.board[to] = p.id;
      } else if (result === 'def') {
        p.alive = false;
      } else {
        p.alive = q.alive = false;
        this.board[to] = -1;
      }
      this.sinceBattle = 0;
      if (q.rank === FLAG && result === 'att') {
        this.finish(p.owner, 'flag');
      }
    }
    this.history.push(ev);
    if (this.phase === 'play') {
      this.turn = 1 - this.turn;
      if (this.sinceBattle >= NO_BATTLE_DRAW) this.finish(null, 'draw');
      else if (this.hasMoves(this.turn) === false) this.finish(1 - this.turn, 'blocked');
    }
    return ev;
  }

  // true/false, или null, если звания игрока неизвестны (соперник в сетевой партии).
  hasMoves(owner) {
    const army = this.army(owner).filter(p => p.alive);
    if (army.some(p => p.rank == null)) return null;
    return this.legalMoves(owner).length > 0;
  }

  finish(winner, reason) {
    this.phase = 'over';
    this.winner = winner;
    this.reason = reason;
  }

  lastMove() {
    return this.history[this.history.length - 1] || null;
  }
}

// Случайная расстановка, удовлетворяющая составу армии (для тестов).
export function randomLayout(owner, rng = Math.random) {
  const cells = [];
  for (let i = 0; i < SIZE * SIZE; i++) if (inHomeRows(owner, i)) cells.push(i);
  const ranks = armyList();
  for (let k = ranks.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [ranks[k], ranks[j]] = [ranks[j], ranks[k]];
  }
  return cells.map((c, k) => [c, ranks[k]]);
}
