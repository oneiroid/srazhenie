// Партия на одном устройстве: вдвоём (с передачей устройства) или против компьютера.
import { Game } from './game.js';
import { aiLayout, aiMove } from './ai.js';
import { WHITE, BLUE, SIDE_NAME } from './rules.js';

const KEY = 'srazhenie.local';
const wait = ms => new Promise(r => setTimeout(r, ms));

export class LocalMatch {
  // opts: { mode: 'ai'|'hotseat', human: WHITE|BLUE (для ai), level }
  constructor(saved, opts, ui) {
    this.ui = ui;
    if (saved) {
      this.st = saved;
      this.game = new Game(saved.game);
    } else {
      this.game = new Game();
      this.st = {
        mode: opts.mode, level: opts.level || 'normal',
        human: opts.mode === 'ai' ? opts.human : null,
        stage: 'setup', setupSide: opts.mode === 'ai' ? opts.human : WHITE,
        viewer: opts.mode === 'ai' ? opts.human : WHITE,
        covered: opts.mode === 'hotseat',
      };
    }
    this.mode = this.st.mode;
    this.busy = false;
  }

  save() {
    localStorage.setItem(KEY, JSON.stringify({ ...this.st, game: this.game.toJSON() }));
  }

  static load() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
  }

  static clear() { localStorage.removeItem(KEY); }

  get viewer() { return this.st.viewer; }
  get stage() { return this.st.stage; }
  get revealAll() { return this.st.stage === 'over'; }
  isAi(side) { return this.mode === 'ai' && side !== this.st.human; }

  canMove() {
    return this.st.stage === 'play' && !this.busy && !this.st.covered && !this.isAi(this.game.turn) && this.game.turn === this.st.viewer;
  }

  status() {
    const g = this.game;
    if (this.st.stage === 'setup') return this.mode === 'hotseat' ? `Расстановка: ${SIDE_NAME[this.st.setupSide]}` : 'Расстановка';
    if (this.st.stage === 'over') return '';
    if (this.isAi(g.turn)) return 'Ход компьютера…';
    if (this.mode === 'hotseat') return `Ход: ${SIDE_NAME[g.turn]}`;
    return 'Ваш ход';
  }

  async resume() {
    if (this.st.covered) await this.cover();
    this.ui.update();
    if (this.st.stage === 'play' && this.isAi(this.game.turn)) this.aiTurn();
  }

  async cover() {
    const s = this.st;
    const text = s.stage === 'setup' ? `Расстановка: ${SIDE_NAME[s.setupSide]}` : `Ход: ${SIDE_NAME[s.viewer]}`;
    await this.ui.cover(text, s.viewer);
    s.covered = false;
    this.save();
    this.ui.update();
    const last = this.game.lastMove();
    if (s.stage === 'play' && last && last.battle) await this.ui.showBattle(last, true);
  }

  async submitSetup(layout) {
    const s = this.st, g = this.game;
    g.placeArmy(s.setupSide, layout);
    if (this.mode === 'ai') {
      g.placeArmy(1 - s.human, aiLayout(1 - s.human));
      g.start();
      s.stage = 'play';
      this.save();
      this.ui.update();
      if (this.isAi(g.turn)) this.aiTurn();
      return;
    }
    if (s.setupSide === WHITE) {
      s.setupSide = BLUE;
      s.viewer = BLUE;
    } else {
      g.start();
      s.stage = 'play';
      s.viewer = WHITE;
    }
    s.covered = true;
    this.save();
    this.ui.update();
    await this.cover();
  }

  async move(from, to) {
    if (!this.canMove()) return;
    this.busy = true;
    const ev = this.game.move(from, to);
    this.save();
    this.ui.update();
    await this.ui.animated(ev);
    this.busy = false;
    if (await this.checkOver()) return;
    if (this.mode === 'hotseat') {
      this.st.viewer = this.game.turn;
      this.st.covered = true;
      this.save();
      this.ui.update();
      await this.cover();
    } else {
      this.ui.update();
      this.aiTurn();
    }
  }

  async aiTurn() {
    const g = this.game;
    if (this.busy || g.phase !== 'play' || !this.isAi(g.turn)) return;
    this.busy = true;
    this.ui.update();
    await wait(450 + Math.random() * 400);
    const m = aiMove(g, g.turn, this.st.level);
    const ev = g.move(m[0], m[1]);
    this.save();
    this.ui.update();
    await this.ui.animated(ev);
    this.busy = false;
    this.ui.update();
    await this.checkOver();
  }

  async checkOver() {
    if (this.game.phase !== 'over') return false;
    this.st.stage = 'over';
    this.st.covered = false;
    this.save();
    this.ui.update();
    this.ui.gameOver();
    return true;
  }

  resign() {
    const g = this.game;
    if (this.st.stage !== 'play') return;
    const loser = this.mode === 'ai' ? this.st.human : g.turn;
    g.finish(1 - loser, 'resign');
    this.checkOver();
  }

  // Результат с точки зрения зрителя: 'win' | 'loss' | 'draw' | сторона-победитель для игры вдвоём.
  outcome() {
    const g = this.game;
    if (g.winner == null) return { text: 'Ничья' };
    if (this.mode === 'hotseat') return { text: `Победили ${SIDE_NAME[g.winner].toLowerCase()}` };
    return { text: g.winner === this.st.human ? 'Победа!' : 'Поражение', win: g.winner === this.st.human };
  }

  rematchOptions() {
    return this.mode === 'ai'
      ? { mode: 'ai', human: 1 - this.st.human, level: this.st.level }
      : { mode: 'hotseat' };
  }
}
