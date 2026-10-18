// Сетевая партия. Звания фишек не передаются: при расстановке каждая сторона публикует
// хэш-обязательство sha256(комната|партия|фишка|звание|соль) для каждой фишки. В бою обе стороны раскрывают
// звание и соль только участвующих фишек, а в конце партии — всех, после чего соперник проверяет честность.
import { Game } from './game.js';
import { Channel, randomCode, randomHex, sha256 } from './net.js';
import { WHITE, BLUE, ARMY_SIZE, RANKS, isMovable, neighbors, isLake } from './rules.js';

// Состояние хранится отдельно для каждой пары (комната, роль): хозяин и гость могут открыть партию
// в двух вкладках одного браузера.
const KEY = 'srazhenie.online';
const LAST = 'srazhenie.online.last';
const ROOMS = 'srazhenie.online.rooms';
const key = (room, role) => `${KEY}.${room}.${role}`;

export class OnlineMatch {
  constructor(saved, opts, ui) {
    this.ui = ui;
    this.mode = 'online';
    if (saved) {
      this.st = saved;
    } else {
      const room = opts.room || randomCode();
      this.st = {
        room, role: opts.role, hostColor: opts.color ?? WHITE,
        chan: Channel.fresh(room, opts.role),
        stage: 'lobby', gameId: 1, myColor: opts.role === 'host' ? (opts.color ?? WHITE) : null,
        game: null, secrets: null, oppCommits: null, sentSetup: false, gotSetup: false,
        pending: null, sentFinal: false, verify: null, rematch: { me: false, opp: false }, joined: false,
      };
    }
    this.game = new Game(this.st.game || undefined);
    this.net = { connected: false, peerOnline: false, error: null };
    this.q = Promise.resolve();
  }

  static load(room, role) {
    try { return JSON.parse(localStorage.getItem(key(room, role))); } catch (e) { return null; }
  }

  static loadLast() {
    try {
      const l = JSON.parse(localStorage.getItem(LAST));
      return l ? OnlineMatch.load(l.room, l.role) : null;
    } catch (e) { return null; }
  }

  save() {
    const s = this.st;
    s.game = this.game.toJSON();
    const k = key(s.room, s.role);
    localStorage.setItem(k, JSON.stringify(s));
    localStorage.setItem(LAST, JSON.stringify({ room: s.room, role: s.role }));
    if (!this._listed) {
      this._listed = true;
      let rooms = [];
      try { rooms = JSON.parse(localStorage.getItem(ROOMS)) || []; } catch (e) { /* ignore */ }
      rooms = [k, ...rooms.filter(x => x !== k)];
      for (const old of rooms.slice(6)) localStorage.removeItem(old);
      localStorage.setItem(ROOMS, JSON.stringify(rooms.slice(0, 6)));
    }
  }

  get room() { return this.st.room; }
  get role() { return this.st.role; }
  get viewer() { return this.st.myColor ?? WHITE; }
  get stage() {
    const s = this.st;
    if (s.stage === 'setup' && s.sentSetup) return 'waitSetup';
    return s.stage;
  }
  get revealAll() { return this.st.stage === 'over' && this.st.verify != null; }
  get opp() { return 1 - this.st.myColor; }

  async resume() {
    this.chan = new Channel(this.st.chan, {
      onmessage: m => { this.q = this.q.then(() => this.handle(m)).catch(e => console.error(e)); },
      onstatus: n => { this.net = n; this.ui.netStatus(n); },
    });
    this.ui.update();
    try {
      await this.chan.start();
    } catch (e) {
      this.ui.update();
      return;
    }
    if (this.st.role === 'guest' && !this.st.joined) {
      this.st.joined = true;
      this.chan.send({ t: 'join' });
      this.save();
    }
    this.ui.update();
  }

  stop() {
    if (this.chan) this.chan.stop();
  }

  canMove() {
    return this.st.stage === 'play' && !this.st.pending && this.game.turn === this.st.myColor;
  }

  status() {
    const s = this.st;
    if (this.net.error) return this.net.error;
    switch (this.stage) {
      case 'lobby': return s.role === 'host' ? 'Ожидание соперника…' : 'Подключение к партии…';
      case 'setup': return 'Расстановка';
      case 'waitSetup': return 'Соперник расставляет фишки…';
      case 'play':
        if (s.pending) return 'Бой…';
        return this.game.turn === s.myColor ? 'Ваш ход' : 'Ход соперника';
      default: return '';
    }
  }

  send(m) {
    this.chan.send(m);
    this.save();
  }

  commitText(id, rank, salt) {
    return `${this.st.room}|${this.st.gameId}|${id}|${rank}|${salt}`;
  }

  async verifyReveal(id, rank, salt) {
    const c = this.st.oppCommits && this.st.oppCommits[id];
    return !!c && c === await sha256(this.commitText(id, rank, salt));
  }

  async submitSetup(layout) {
    const s = this.st, me = s.myColor;
    // Порядок фишек случаен: иначе номер фишки выдавал бы её звание.
    layout = [...layout];
    const rnd = crypto.getRandomValues(new Uint32Array(layout.length));
    for (let k = layout.length - 1; k > 0; k--) {
      const j = rnd[k] % (k + 1);
      [layout[k], layout[j]] = [layout[j], layout[k]];
    }
    s.secrets = {};
    const commits = {}, positions = {};
    for (let k = 0; k < layout.length; k++) {
      const id = me * ARMY_SIZE + k, [pos, rank] = layout[k], salt = randomHex(12);
      s.secrets[id] = [rank, salt];
      commits[id] = await sha256(this.commitText(id, rank, salt));
      positions[id] = pos;
    }
    this.game.placeArmy(me, layout);
    s.sentSetup = true;
    this.send({ t: 'setup', g: s.gameId, positions, commits });
    this.maybeStart();
    this.ui.update();
  }

  maybeStart() {
    const s = this.st;
    if (s.stage === 'setup' && s.sentSetup && s.gotSetup) {
      this.game.start();
      s.stage = 'play';
      this.save();
    }
  }

  async move(from, to) {
    if (!this.canMove() || !this.game.movesFrom(from).includes(to)) return;
    const s = this.st, g = this.game, n = g.history.length;
    if (g.isAttack(from, to)) {
      const p = g.at(from), [rank, salt] = s.secrets[p.id];
      s.pending = { n, from, to };
      this.send({ t: 'move', g: s.gameId, n, from, to, reveal: { id: p.id, rank, salt } });
      this.ui.update();
      return;
    }
    const ev = g.move(from, to);
    this.send({ t: 'move', g: s.gameId, n, from, to });
    await this.after(ev);
  }

  async after(ev) {
    this.save();
    this.ui.update();
    await this.ui.animated(ev);
    const g = this.game;
    if (g.phase === 'over') {
      // Ход соперника заблокировал все наши фишки — сообщаем ему об этом.
      if (g.reason === 'blocked' && g.winner === this.opp) this.send({ t: 'blocked', g: this.st.gameId });
      this.over();
    }
    this.ui.update();
  }

  over() {
    const s = this.st;
    if (s.stage === 'over') return;
    s.stage = 'over';
    if (!s.sentFinal) {
      s.sentFinal = true;
      this.send({ t: 'final', g: s.gameId, secrets: s.secrets });
    }
    this.save();
    this.ui.update();
    this.ui.gameOver();
  }

  cheat(text) {
    this.st.verify = { ok: false, text };
    if (this.game.phase !== 'over') this.game.finish(this.st.myColor, 'cheat');
    this.over();
    this.save();
    this.ui.gameOver();
  }

  async handle(m) {
    const s = this.st, g = this.game;
    if (m.g != null && m.g !== s.gameId) return;
    switch (m.t) {
      case 'join':
        if (s.role === 'host' && s.stage === 'lobby') {
          s.stage = 'setup';
          s.myColor = s.hostColor;
          this.send({ t: 'welcome', gameId: s.gameId, hostColor: s.hostColor });
        }
        break;
      case 'welcome':
        if (s.role === 'guest' && s.stage === 'lobby') {
          s.gameId = m.gameId;
          s.myColor = 1 - m.hostColor;
          s.stage = 'setup';
        }
        break;
      case 'setup': {
        if (s.gotSetup) break;
        g.placeHidden(this.opp, m.positions);
        s.oppCommits = m.commits;
        s.gotSetup = true;
        this.maybeStart();
        break;
      }
      case 'move': {
        if (s.stage !== 'play' || m.n !== g.history.length || g.turn !== this.opp) return this.cheat('Получен ход вне очереди');
        const p = g.at(m.from), q = g.at(m.to);
        const legal = p && p.owner === this.opp && neighbors(m.from).includes(m.to) && !isLake(m.to)
          && !(q && q.owner === this.opp) && !g.shuttleBlocked(this.opp, p.id, m.from, m.to);
        if (!legal) return this.cheat('Соперник сделал недопустимый ход');
        let ev;
        if (q) {
          const r = m.reveal;
          if (!r || r.id !== p.id || !isMovable(r.rank) || !await this.verifyReveal(r.id, r.rank, r.salt)) {
            return this.cheat('Звание атакующей фишки не совпадает с расстановкой');
          }
          const [rank, salt] = s.secrets[q.id];
          this.send({ t: 'reveal', g: s.gameId, n: m.n, id: q.id, rank, salt });
          ev = g.move(m.from, m.to, { att: r.rank });
        } else {
          ev = g.move(m.from, m.to);
        }
        await this.after(ev);
        return;
      }
      case 'reveal': {
        const pd = s.pending;
        if (!pd || pd.n !== m.n) break;
        const q = g.at(pd.to);
        if (!q || q.id !== m.id || !await this.verifyReveal(m.id, m.rank, m.salt)) {
          return this.cheat('Звание фишки соперника не совпадает с расстановкой');
        }
        s.pending = null;
        const ev = g.move(pd.from, pd.to, { def: m.rank });
        await this.after(ev);
        return;
      }
      case 'blocked':
        if (g.phase === 'play') g.finish(s.myColor, 'blocked');
        this.over();
        return;
      case 'resign':
        if (g.phase === 'play') g.finish(s.myColor, 'resign');
        this.over();
        return;
      case 'final':
        await this.checkFinal(m.secrets || {});
        break;
      case 'rematch':
        s.rematch.opp = true;
        if (s.rematch.me) this.newGame();
        break;
    }
    this.save();
    this.ui.update();
  }

  // Проверка честности соперника по раскрытой в конце расстановке.
  async checkFinal(secrets) {
    const s = this.st, g = this.game;
    if (s.verify && !s.verify.ok) return;
    let problem = null;
    const counts = {};
    for (const p of g.army(this.opp)) {
      const sec = secrets[p.id];
      if (!sec || !await this.verifyReveal(p.id, sec[0], sec[1])) { problem = 'Расстановка не совпадает с обязательствами'; break; }
      const rank = sec[0];
      counts[rank] = (counts[rank] || 0) + 1;
      if (p.rank != null && p.rank !== rank) { problem = 'Раскрытое звание не совпадает'; break; }
      if (p.moved && !isMovable(rank)) { problem = 'Двигалась мина или знамя'; break; }
      p.rank = rank;
    }
    if (!problem && RANKS.some(r => (counts[r.id] || 0) !== r.count)) problem = 'Неверный состав армии';
    s.verify = problem ? { ok: false, text: problem } : { ok: true, text: 'Расстановка соперника проверена' };
    if (g.phase !== 'over') g.finish(s.myColor, 'cheat');
    if (problem && g.reason !== 'cheat') { g.winner = s.myColor; g.reason = 'cheat'; }
    this.over();
    this.save();
    this.ui.update();
    this.ui.gameOver();
  }

  resign() {
    if (this.st.stage !== 'play') return;
    this.game.finish(this.opp, 'resign');
    this.send({ t: 'resign', g: this.st.gameId });
    this.over();
  }

  requestRematch() {
    const s = this.st;
    if (s.stage !== 'over' || s.rematch.me) return;
    s.rematch.me = true;
    this.send({ t: 'rematch', g: s.gameId });
    if (s.rematch.opp) this.newGame();
    this.ui.update();
  }

  newGame() {
    const s = this.st;
    s.gameId++;
    s.myColor = 1 - s.myColor;
    s.hostColor = 1 - s.hostColor;
    Object.assign(s, {
      stage: 'setup', secrets: null, oppCommits: null, sentSetup: false, gotSetup: false,
      pending: null, sentFinal: false, verify: null, rematch: { me: false, opp: false },
    });
    this.game = new Game();
    this.save();
    this.ui.closeDialogs();
    this.ui.update();
  }

  outcome() {
    const g = this.game, s = this.st;
    if (g.winner == null) return { text: 'Ничья' };
    return { text: g.winner === s.myColor ? 'Победа!' : 'Поражение', win: g.winner === s.myColor };
  }
}

export { WHITE, BLUE };
