import {
  SIZE, WHITE, BLUE, SIDE_NAME, RANKS, RANK, MINE, FLAG, ARMY_SIZE, NO_BATTLE_DRAW,
  idx, rowOf, colOf, isLake, inHomeRows, homeCells, isMovable,
} from './rules.js';
import { aiLayout } from './ai.js';
import { LocalMatch } from './local.js';
import { OnlineMatch } from './online.js';
import { normalizeCode } from './net.js';
import { drawBoard } from './board.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const wait = ms => new Promise(r => setTimeout(r, ms));

const RANK_INFO = {
  1: 'Сильнейший. Погибает, только если на него нападёт Разведчик.',
  2: 'Бьёт всех, кроме Маршала.',
  3: 'Бьёт Майора и младше.',
  4: 'Бьёт Капитана и младше.',
  5: 'Бьёт Лейтенанта и младше.',
  6: 'Бьёт Сержанта и младше.',
  7: 'Бьёт Сапёра, Солдата и Разведчика.',
  8: 'Единственный, кто обезвреживает мины.',
  9: 'Бьёт только Разведчика.',
  10: 'Младший, но побеждает Маршала, если нападает первым.',
  [MINE]: 'Не ходит. Уничтожает любого нападающего, кроме Сапёра.',
  [FLAG]: 'Не ходит. Захват знамени — победа.',
};
const REASON = {
  flag: 'Знамя захвачено',
  blocked: 'Не осталось ходов',
  resign: 'Сдача',
  draw: `${NO_BATTLE_DRAW} ходов без сражений`,
  cheat: 'Нарушение правил соперником',
};

// Абсолютный адрес: относительный url() в CSS-переменной разрешается от файла стилей.
const imgUrl = rank => new URL(`img/pieces/${RANK[rank].key}.webp`, document.baseURI).href;

// Элемент фишки. rank === null — рубашка.
function pieceEl(owner, rank, extra = '') {
  const e = el('div', `pc ${owner === WHITE ? 'w' : 'b'} ${rank == null ? 'back' : 'face'} ${extra}`);
  const card = el('div', 'card');
  if (rank != null) {
    const art = el('div', 'art');
    art.style.setProperty('--img', `url(${imgUrl(rank)})`);
    card.append(art);
  }
  e.append(card);
  return e;
}

// ---------- Состояние интерфейса ----------

const app = {
  match: null,
  sel: -1,          // выбранная клетка (поле, индекс в координатах игры)
  traySel: null,    // выбранное звание в лотке расстановки
  layout: new Map(), // расстановка: клетка → звание
  pieceEls: new Map(),
  infoText: '',
};

const LAYOUT_KEY = 'srazhenie.layout';
const LAST_KEY = 'srazhenie.last';

// Клетка в экранных координатах: у синих поле повёрнуто на 180°.
const disp = i => (app.match && app.match.viewer === BLUE ? SIZE * SIZE - 1 - i : i);

// ---------- Меню ----------

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
}

function menuPage(name) {
  document.querySelectorAll('.menu-page').forEach(p => { p.hidden = p.dataset.page !== name; });
  $('#menuArt').hidden = name === 'rules';
  if (name === 'main') refreshContinue();
}

function segValue(name) {
  return $(`.seg[data-name="${name}"] button.on`).dataset.v;
}

function refreshContinue() {
  const last = localStorage.getItem(LAST_KEY);
  const has = (last === 'online' && OnlineMatch.loadLast()) || (last === 'local' && LocalMatch.load());
  $('#btnContinue').hidden = !has;
}

function initMenu() {
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => menuPage(b.dataset.go)));
  document.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  }));
  $('#btnStartAi').onclick = () => startLocal({ mode: 'ai', human: +segValue('aiColor'), level: segValue('level') });
  $('#btnHotseat').onclick = () => startLocal({ mode: 'hotseat' });
  $('#btnCreate').onclick = () => {
    const v = segValue('netColor');
    const color = v === 'r' ? (Math.random() < .5 ? WHITE : BLUE) : +v;
    startOnline(null, { role: 'host', color });
  };
  $('#btnJoin').onclick = () => {
    const code = normalizeCode($('#joinCode').value);
    if (code.length < 4) { toast('Введите код партии'); return; }
    joinRoom(code);
  };
  $('#joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnJoin').click(); });
  $('#btnContinue').onclick = () => {
    const last = localStorage.getItem(LAST_KEY);
    if (last === 'online') startOnline(OnlineMatch.loadLast());
    else startLocal(null, LocalMatch.load());
  };
  $('#btnMenu').onclick = openGameMenu;

  const art = $('#menuArt');
  for (const r of [1, 3, 8, 10, FLAG]) art.append(pieceEl(r % 2 ? WHITE : BLUE, r));
  $('#rulesText').innerHTML = rulesHtml();
}

function rulesHtml() {
  const rows = RANKS.map(r => {
    const tmp = el('div');
    tmp.append(pieceEl(WHITE, r.id));
    return `<tr><td>${tmp.innerHTML}</td><td><b>${r.name}</b> ×${r.count}<br><small>${RANK_INFO[r.id]}</small></td></tr>`;
  }).join('');
  return `
  <h3>Цель</h3><p>Захватить знамя противника или лишить его возможности ходить.</p>
  <h3>Армия</h3><p>У каждого игрока 40 фишек. Звания перечислены от старшего к младшему.</p>
  <table>${rows}</table>
  <h3>Расстановка</h3><p>Каждый расставляет фишки в своих четырёх рядах. Звания фишек противника скрыты.</p>
  <h3>Ход</h3><ul>
    <li>Белые ходят первыми, далее по очереди.</li>
    <li>Фишка ходит на одну клетку вперёд, назад или вбок, не по диагонали. Через озёра проходить нельзя.</li>
    <li>Мины и знамя не ходят.</li>
    <li>Одна фишка не может ходить туда-обратно между двумя клетками больше трёх раз подряд.</li>
  </ul>
  <h3>Атака</h3><ul>
    <li>Чтобы атаковать, сходите на клетку с фишкой противника. Звания обеих фишек открываются.</li>
    <li>Младшая по званию фишка снимается с поля; при равных званиях погибают обе. Победивший нападающий занимает клетку.</li>
    <li>Разведчик побеждает Маршала, только если нападает первым.</li>
    <li>Мина уничтожает любого нападающего, кроме Сапёра. Сапёр обезвреживает мину и занимает её клетку.</li>
    <li>Фишки, участвовавшие в бою, остаются открытыми (жёлтая метка).</li>
  </ul>
  <h3>Конец партии</h3><p>Захват знамени; у игрока не осталось ходов; сдача. ${NO_BATTLE_DRAW} ходов подряд без сражений — ничья.</p>
  <h3>Игра по сети</h3><p>Создайте партию и отправьте сопернику ссылку или код. Звания фишек не передаются до боя;
  в конце партии расстановки сверяются с зашифрованными при старте отпечатками, так что подменить фишку нельзя.</p>`;
}

// ---------- Запуск партий ----------

function stopMatch() {
  if (app.match && app.match.stop) app.match.stop();
  app.match = null;
  app.pieceEls.clear();
  $('#pieces').innerHTML = '';
  closeDialogs();
}

function resetSelection() {
  app.sel = -1;
  app.traySel = null;
  app.layout = new Map();
  app.infoText = '';
}

function startLocal(opts, saved) {
  stopMatch();
  resetSelection();
  if (!saved) LocalMatch.clear();
  app.match = new LocalMatch(saved, opts, ui);
  localStorage.setItem(LAST_KEY, 'local');
  showScreen('play');
  app.match.save();
  app.match.resume();
}

function startOnline(saved, opts) {
  stopMatch();
  resetSelection();
  app.match = new OnlineMatch(saved, opts, ui);
  localStorage.setItem(LAST_KEY, 'online');
  app.match.save();
  showScreen('play');
  setHash(app.match.room);
  app.match.resume();
}

// Открыта ли эта партия в этой роли в другой вкладке.
const tabs = 'BroadcastChannel' in window ? new BroadcastChannel('srazhenie') : null;
if (tabs) {
  tabs.onmessage = e => {
    const m = app.match, q = e.data;
    if (q && q.q === 'live?' && m && m.mode === 'online' && m.room === q.room && m.role === q.role) {
      tabs.postMessage({ a: 'live', room: q.room, role: q.role });
    }
  };
}
function liveElsewhere(room, role) {
  if (!tabs) return Promise.resolve(false);
  return new Promise(resolve => {
    const t = setTimeout(() => { tabs.removeEventListener('message', on); resolve(false); }, 250);
    const on = e => {
      if (e.data && e.data.a === 'live' && e.data.room === room && e.data.role === role) {
        clearTimeout(t); tabs.removeEventListener('message', on); resolve(true);
      }
    };
    tabs.addEventListener('message', on);
    tabs.postMessage({ q: 'live?', room, role });
  });
}

async function joinRoom(code) {
  for (const role of ['host', 'guest']) {
    const saved = OnlineMatch.load(code, role);
    if (saved && !(await liveElsewhere(code, role))) { startOnline(saved); return; }
  }
  startOnline(null, { role: 'guest', room: code });
}

function setHash(room) {
  history.replaceState(null, '', room ? `#${room}` : location.pathname + location.search);
}

function inviteLink() {
  return `${location.origin}${location.pathname}#${app.match.room}`;
}

function toMenu() {
  stopMatch();
  setHash(null);
  showScreen('menu');
  menuPage('main');
}

// ---------- Отрисовка ----------

function initBoard() {
  const cells = $('#cells');
  for (let d = 0; d < SIZE * SIZE; d++) {
    const c = el('div', 'cell');
    c.dataset.d = d;
    cells.append(c);
  }
  const board = $('#board');
  board.addEventListener('pointerdown', onPointerDown);
  board.addEventListener('pointerup', onPointerUp);
  board.addEventListener('contextmenu', e => e.preventDefault());
  $('#board').style.backgroundImage = `url(${drawBoard(900)})`;
}

function stageOf() {
  return app.match ? app.match.stage : null;
}

// Что видит зритель в клетке i: { owner, rank|null, revealed } или null.
function visiblePieces() {
  const m = app.match, g = m.game, out = [];
  const stage = stageOf();
  if (stage === 'setup') {
    for (const [pos, rank] of app.layout) out.push({ key: 's' + pos, pos, owner: m.viewer, rank });
    // В сетевой партии уже расставленные фишки соперника видны рубашкой.
    for (const p of g.pieces) if (p.owner !== m.viewer && p.pos >= 0 && p.alive) out.push({ key: p.id, pos: p.pos, owner: p.owner, rank: null });
    return out;
  }
  for (const p of g.pieces) {
    if (!p.alive || p.pos < 0) continue;
    const own = p.owner === m.viewer;
    if (m.mode === 'hotseat' && m.st.covered) continue;
    const show = own || p.revealed || m.revealAll;
    out.push({ key: p.id, pos: p.pos, owner: p.owner, rank: show && p.rank != null ? p.rank : null, rev: !own && p.revealed && !m.revealAll });
  }
  return out;
}

function renderPieces() {
  const layer = $('#pieces');
  const seen = new Set();
  for (const v of visiblePieces()) {
    seen.add(v.key);
    const sig = `${v.owner}|${v.rank}|${v.rev ? 1 : 0}`;
    let e = app.pieceEls.get(v.key);
    if (!e || e.dataset.sig !== sig) {
      const ne = pieceEl(v.owner, v.rank, v.rev ? 'rev' : '');
      ne.dataset.sig = sig;
      if (e) {
        ne.style.left = e.style.left;
        ne.style.top = e.style.top;
        e.replaceWith(ne);
      } else {
        layer.append(ne);
      }
      e = ne;
      app.pieceEls.set(v.key, e);
    }
    const d = disp(v.pos);
    e.style.left = `${colOf(d) * 10}%`;
    e.style.top = `${rowOf(d) * 10}%`;
    e.classList.toggle('sel', v.pos === app.sel);
  }
  for (const [key, e] of app.pieceEls) {
    if (!seen.has(key)) {
      app.pieceEls.delete(key);
      e.classList.add('gone');
      setTimeout(() => e.remove(), 300);
    }
  }
}

function renderCells() {
  const m = app.match, g = m.game, stage = stageOf();
  const targets = new Set(), attacks = new Set();
  if (stage === 'play' && app.sel >= 0 && m.canMove()) {
    for (const t of g.movesFrom(app.sel)) (g.at(t) ? attacks : targets).add(t);
  }
  const last = stage === 'play' || stage === 'over' ? g.lastMove() : null;
  const hidden = m.mode === 'hotseat' && m.st.covered;
  document.querySelectorAll('.cell').forEach(c => {
    const i = disp(+c.dataset.d);
    c.className = 'cell';
    if (stage === 'setup' && inHomeRows(m.viewer, i)) c.classList.add('home', ...(app.layout.has(i) ? ['filled'] : []));
    if (targets.has(i)) c.classList.add('target');
    if (attacks.has(i)) c.classList.add('attack');
    if (last && !hidden) {
      if (i === last.to) c.classList.add('last');
      else if (i === last.from) c.classList.add('lastfrom');
    }
  });
}

function trayItem(rank, owner, count, opts = {}) {
  const b = el('button', `ti${opts.on ? ' on' : ''}${count === 0 ? ' zero' : ''}${opts.dim ? ' empty' : ''}`);
  b.append(pieceEl(owner, rank));
  b.append(el('span', 'nm', RANK[rank].name));
  if (count != null) b.append(el('span', 'ct', String(count)));
  b.dataset.rank = rank;
  return b;
}

function renderPanel() {
  const m = app.match, g = m.game, stage = stageOf();
  const tray = $('#tray'), actions = $('#actions'), lobby = $('#lobby');
  tray.innerHTML = '';
  actions.innerHTML = '';
  lobby.hidden = true;
  let info = app.infoText;

  if (stage === 'lobby') {
    lobby.hidden = false;
    if (!lobby.dataset.room || lobby.dataset.room !== m.room) {
      lobby.dataset.room = m.room;
      lobby.innerHTML = m.st.role === 'host'
        ? `<div>Код партии</div><div class="code">${m.room}</div>
           <div class="row"><button class="btn small" id="btnShare">Отправить ссылку</button><button class="btn small" id="btnCopy">Копировать</button></div>`
        : `<div>Партия</div><div class="code">${m.room}</div>`;
      const share = lobby.querySelector('#btnShare');
      if (share) {
        share.onclick = async () => {
          const url = inviteLink();
          if (navigator.share) {
            try { await navigator.share({ title: 'Сражение', text: `Сыграем в «Сражение»? Код: ${m.room}`, url }); } catch (e) { /* отменено */ }
          } else copy(url);
        };
        lobby.querySelector('#btnCopy').onclick = () => copy(inviteLink());
      }
    }
    info = '';
  } else if (stage === 'setup') {
    const left = remainingToPlace();
    for (const r of RANKS) tray.append(trayItem(r.id, m.viewer, left[r.id], { on: app.traySel === r.id, dim: left[r.id] === 0 }));
    if (!info) info = app.layout.size < ARMY_SIZE
      ? 'Выберите фишку внизу и клетку в своих рядах. Нажмите на поставленную фишку, чтобы переставить её.'
      : 'Все фишки расставлены.';
    actions.append(button('Случайно', autoSetup));
    const saved = loadSavedLayout();
    if (saved) actions.append(button('Прошлая', () => { app.layout = saved; app.sel = -1; app.traySel = null; update(); }));
    actions.append(button('Очистить', () => { app.layout = new Map(); app.sel = -1; update(); }));
    const ready = button('Готово', submitSetup, 'primary');
    ready.disabled = app.layout.size < ARMY_SIZE;
    actions.append(ready);
  } else if (stage === 'waitSetup') {
    info = 'Ваша расстановка отправлена.';
    legend(tray, m, g);
  } else if (stage === 'play' || stage === 'over') {
    legend(tray, m, g);
    if (stage === 'play') {
      actions.append(button('Сдаться', () => confirmDialog('Сдаться?', 'Сдаться', () => m.resign())));
    } else {
      actions.append(button('Итоги', () => gameOver()));
      if (!(m.mode === 'online' && m.st.rematch.me)) actions.append(button(m.mode === 'online' ? 'Реванш' : 'Новая партия', () => rematch(), 'primary'));
    }
  }
  $('#info').innerHTML = info;
}

// Сколько фишек противника каждого звания ещё на поле.
function legend(tray, m, g) {
  const opp = 1 - m.viewer;
  const h = el('div', 'legend-title', 'Силы противника');
  tray.append(h);
  for (const r of RANKS) {
    const lost = g.pieces.filter(p => p.owner === opp && !p.alive && p.rank === r.id).length;
    tray.append(trayItem(r.id, opp, r.count - lost));
  }
}

function button(text, fn, cls = '') {
  const b = el('button', `btn small ${cls}`, text);
  b.onclick = fn;
  return b;
}

function update() {
  const m = app.match;
  if (!m) return;
  $('#status').textContent = m.status();
  renderCells();
  renderPieces();
  renderPanel();
  $('#netDot').hidden = m.mode !== 'online';
}

// ---------- Расстановка ----------

function remainingToPlace() {
  const left = Object.fromEntries(RANKS.map(r => [r.id, r.count]));
  for (const r of app.layout.values()) left[r]--;
  return left;
}

function autoSetup() {
  const m = app.match;
  app.layout = new Map(aiLayout(m.viewer));
  app.sel = -1;
  app.traySel = null;
  update();
}

// Расстановка хранится в координатах «от игрока»: ряд от передней линии и колонка слева направо.
function saveLayout() {
  const owner = app.match.viewer;
  const rel = [...app.layout].map(([pos, rank]) => {
    const r = owner === WHITE ? rowOf(pos) - 6 : 3 - rowOf(pos);
    const c = owner === WHITE ? colOf(pos) : 9 - colOf(pos);
    return [r, c, rank];
  });
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(rel));
}

function loadSavedLayout() {
  try {
    const rel = JSON.parse(localStorage.getItem(LAYOUT_KEY));
    if (!rel || rel.length !== ARMY_SIZE) return null;
    const owner = app.match.viewer, out = new Map();
    for (const [r, c, rank] of rel) out.set(owner === WHITE ? idx(6 + r, c) : idx(3 - r, 9 - c), rank);
    return out.size === ARMY_SIZE ? out : null;
  } catch (e) { return null; }
}

function submitSetup() {
  if (app.layout.size < ARMY_SIZE) return;
  saveLayout();
  const layout = [...app.layout];
  app.layout = new Map();
  app.sel = -1;
  app.traySel = null;
  app.infoText = '';
  app.match.submitSetup(layout);
}

function setupTap(i) {
  const m = app.match;
  if (!inHomeRows(m.viewer, i)) { app.sel = -1; update(); return; }
  const here = app.layout.get(i);
  if (app.traySel != null) {
    if (here != null) app.layout.delete(i);
    app.layout.set(i, app.traySel);
    if (remainingToPlace()[app.traySel] <= 0) app.traySel = null;
    app.sel = -1;
  } else if (app.sel >= 0) {
    const a = app.layout.get(app.sel);
    if (i !== app.sel) {
      if (here != null) app.layout.set(app.sel, here); else app.layout.delete(app.sel);
      app.layout.set(i, a);
    }
    app.sel = -1;
  } else if (here != null) {
    app.sel = i;
    app.infoText = `<b>${RANK[here].name}</b>. Нажмите клетку, чтобы переставить, или фишку внизу, чтобы убрать.`;
    update();
    app.infoText = '';
    return;
  }
  update();
}

function trayTap(rank) {
  if (stageOf() === 'setup') {
    if (app.sel >= 0) {
      // Выбранная на поле фишка возвращается в лоток.
      app.layout.delete(app.sel);
      app.sel = -1;
      update();
      return;
    }
    if (remainingToPlace()[rank] <= 0) return;
    app.traySel = app.traySel === rank ? null : rank;
    app.infoText = app.traySel ? `<b>${RANK[rank].name}</b> — ${RANK_INFO[rank]}` : '';
    update();
    app.infoText = app.traySel ? app.infoText : '';
    return;
  }
  app.infoText = `<b>${RANK[rank].name}</b> — ${RANK_INFO[rank]}`;
  update();
  app.infoText = '';
}

// ---------- Ходы ----------

let downCell = -1;

function cellFromEvent(e) {
  const r = $('#board').getBoundingClientRect();
  const c = Math.floor((e.clientX - r.left) / r.width * SIZE), w = Math.floor((e.clientY - r.top) / r.height * SIZE);
  if (c < 0 || c >= SIZE || w < 0 || w >= SIZE) return -1;
  return disp(idx(w, c));
}

function onPointerDown(e) {
  if (!app.match) return;
  downCell = cellFromEvent(e);
  if (downCell < 0) return;
  const stage = stageOf();
  if (stage === 'setup') return;
  if (stage === 'play') {
    const m = app.match, p = m.game.at(downCell);
    if (p && p.owner === m.viewer && m.canMove() && app.sel !== downCell) {
      selectPiece(downCell);
      downCell = -2; // выбор уже сделан на нажатии; отпускание на той же клетке не снимает выбор
    }
  }
}

function onPointerUp(e) {
  if (!app.match) return;
  const i = cellFromEvent(e);
  const stage = stageOf();
  if (i < 0) return;
  if (stage === 'setup') { if (downCell === i) setupTap(i); return; }
  if (stage !== 'play') return;
  const m = app.match;
  if (downCell === -2 && i === app.sel) return;
  if (app.sel >= 0 && i !== app.sel && m.canMove() && m.game.movesFrom(app.sel).includes(i)) {
    const from = app.sel;
    app.sel = -1;
    m.move(from, i);
    return;
  }
  if (downCell !== i && downCell !== -2) return;
  const p = m.game.at(i);
  if (p && p.owner === m.viewer) {
    if (app.sel === i) { app.sel = -1; update(); } else selectPiece(i);
  } else if (p && (p.revealed || m.revealAll) && p.rank != null) {
    app.infoText = `Противник: <b>${RANK[p.rank].name}</b> — ${RANK_INFO[p.rank]}`;
    app.sel = -1;
    update();
    app.infoText = '';
  } else {
    app.sel = -1;
    update();
  }
}

function selectPiece(i) {
  const m = app.match, p = m.game.at(i);
  app.sel = isMovable(p.rank) && m.canMove() ? i : -1;
  app.infoText = `<b>${RANK[p.rank].name}</b> — ${RANK_INFO[p.rank]}`;
  if (isMovable(p.rank) && m.canMove() && !m.game.movesFrom(i).length) app.infoText += ' Ходов нет.';
  update();
  app.infoText = '';
}

// ---------- Оверлеи ----------

function cover(text, side) {
  return new Promise(resolve => {
    const c = $('#cover');
    $('#coverText').textContent = text;
    c.className = `overlay ${side === WHITE ? 'w' : 'b'}`;
    c.hidden = false;
    c.onclick = () => { c.hidden = true; resolve(); };
  });
}

function battleText(b) {
  const a = RANK[b.attRank].name, d = RANK[b.defRank].name;
  if (b.defRank === FLAG) return 'Знамя захвачено!';
  if (b.defRank === MINE) return b.result === 'att' ? 'Сапёр обезвредил мину' : `Мина! ${a} погиб`;
  if (b.attRank === 10 && b.defRank === 1) return 'Разведчик сразил Маршала!';
  if (b.result === 'both') return 'Оба погибли';
  return b.result === 'att' ? `${a} побеждает` : `${d} побеждает`;
}

function showBattle(ev, replay = false) {
  const b = ev.battle;
  if (!b) return Promise.resolve();
  const m = app.match, g = m.game;
  const att = g.pieces[b.attId], def = g.pieces[b.defId];
  let who;
  if (m.mode === 'hotseat') who = replay ? `${SIDE_NAME[att.owner]} атаковали вас` : `${SIDE_NAME[att.owner]} атакуют`;
  else who = att.owner === m.viewer ? 'Вы атакуете' : 'Противник атакует';
  const box = $('#battle .battle-box');
  box.innerHTML = '';
  box.append(el('div', 'who', who));
  const vs = el('div', 'vs');
  const side = (piece, rank, lost) => {
    const s = el('div', `side${lost ? ' lost' : ''}`);
    s.append(pieceEl(piece.owner, rank));
    s.append(el('div', 'nm', RANK[rank].name));
    return s;
  };
  vs.append(side(att, b.attRank, b.result !== 'att'), el('div', 'x', '⚔'), side(def, b.defRank, b.result !== 'def'));
  box.append(vs, el('div', 'res', battleText(b)));
  const o = $('#battle');
  o.hidden = false;
  return new Promise(resolve => {
    let done = false;
    const close = () => { if (done) return; done = true; o.hidden = true; resolve(); };
    o.onclick = close;
    setTimeout(close, b.defRank === FLAG ? 2600 : 2000);
  });
}

async function animated(ev) {
  if (ev.battle) await showBattle(ev);
  else await wait(280);
}

function dialog(build) {
  const o = $('#dialog'), box = o.querySelector('.dialog-box');
  box.innerHTML = '';
  build(box);
  o.hidden = false;
}

function closeDialogs() {
  $('#dialog').hidden = true;
  $('#battle').hidden = true;
  $('#cover').hidden = true;
}

function confirmDialog(text, okText, fn) {
  dialog(box => {
    box.append(el('h2', '', text));
    box.append(button(okText, () => { closeDialogs(); fn(); }, 'primary'));
    box.append(button('Отмена', closeDialogs));
  });
}

function gameOver() {
  const m = app.match;
  if (!m || m.stage !== 'over') return;
  const g = m.game, o = m.outcome();
  dialog(box => {
    box.append(el('h2', o.win ? 'win' : '', o.text));
    let reason = REASON[g.reason] || '';
    if (g.reason === 'resign' && g.winner != null) {
      reason = m.mode === 'hotseat' ? `${SIDE_NAME[1 - g.winner]} сдались` : (g.winner === m.viewer ? 'Противник сдался' : 'Вы сдались');
    }
    if (g.reason === 'blocked' && g.winner != null) {
      reason = m.mode === 'hotseat' ? `У армии «${SIDE_NAME[1 - g.winner]}» не осталось ходов`
        : (g.winner === m.viewer ? 'У противника не осталось ходов' : 'У вас не осталось ходов');
    }
    box.append(el('p', '', reason));
    if (m.mode === 'online') {
      const v = m.st.verify;
      box.append(el('p', v ? (v.ok ? 'ok' : 'bad') : '', v ? v.text : 'Проверка расстановки соперника…'));
    }
    box.append(button('Посмотреть поле', closeDialogs));
    if (m.mode === 'online' && m.st.rematch.me) box.append(el('p', '', 'Ждём согласия соперника на реванш…'));
    else box.append(button(m.mode === 'online' ? 'Реванш' : 'Новая партия', rematch, 'primary'));
    box.append(button('В меню', toMenu));
  });
}

function rematch() {
  const m = app.match;
  if (m.mode === 'online') { m.requestRematch(); gameOver(); return; }
  startLocal(m.rematchOptions());
}

function openGameMenu() {
  const m = app.match;
  dialog(box => {
    box.append(el('h2', '', 'Меню'));
    box.append(button('Продолжить', closeDialogs, 'primary'));
    if (m && m.mode === 'online' && m.stage !== 'lobby') {
      box.append(el('p', '', `Партия <b>${m.room}</b>`));
    }
    box.append(button('Правила', () => { closeDialogs(); toMenu(); menuPage('rules'); }));
    box.append(button('Выйти в меню', toMenu));
    if (m && m.mode !== 'online') box.append(el('p', '', 'Партия сохраняется автоматически.'));
  });
}

function netStatus(n) {
  const d = $('#netDot');
  d.className = n.error ? 'bad' : !n.connected ? 'bad' : n.peerOnline ? 'ok' : 'half';
  d.title = n.error || (!n.connected ? 'Нет связи с сервером' : n.peerOnline ? 'Соперник на связи' : 'Соперник не в сети');
  if (app.match) $('#status').textContent = app.match.status();
}

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Ссылка скопирована'); } catch (e) { prompt('Ссылка на партию:', text); }
}

const ui = { update, cover, showBattle, animated, gameOver, netStatus, closeDialogs };

// ---------- Старт ----------

function init() {
  for (const r of RANKS) new Image().src = imgUrl(r.id);
  initMenu();
  initBoard();
  $('#tray').addEventListener('click', e => {
    const b = e.target.closest('.ti');
    if (b) trayTap(+b.dataset.rank);
  });
  const code = normalizeCode(location.hash.slice(1));
  if (code.length >= 4) joinRoom(code);
  else menuPage('main');
  window.addEventListener('hashchange', () => {
    const c = normalizeCode(location.hash.slice(1));
    if (c.length >= 4 && (!app.match || app.match.room !== c)) joinRoom(c);
  });
}

init();
window.srazhenie = app; // для отладки из консоли
