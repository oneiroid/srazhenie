// Правила «Сражения»: состав армий, поле, ходы, исход боя.

export const SIZE = 10;
export const WHITE = 0, BLUE = 1;
export const SIDE_NAME = ['Белые', 'Синие'];

export const MINE = 11, FLAG = 12;

export const RANKS = [
  { id: 1, key: 'marshal', name: 'Маршал', count: 1, value: 10 },
  { id: 2, key: 'general', name: 'Генерал', count: 1, value: 8 },
  { id: 3, key: 'colonel', name: 'Полковник', count: 2, value: 6 },
  { id: 4, key: 'major', name: 'Майор', count: 3, value: 5 },
  { id: 5, key: 'captain', name: 'Капитан', count: 4, value: 4 },
  { id: 6, key: 'lieutenant', name: 'Лейтенант', count: 4, value: 3 },
  { id: 7, key: 'sergeant', name: 'Сержант', count: 4, value: 2.4 },
  { id: 8, key: 'sapper', name: 'Сапёр', count: 5, value: 3 },
  { id: 9, key: 'soldier', name: 'Солдат', count: 8, value: 1 },
  { id: 10, key: 'scout', name: 'Разведчик', count: 1, value: 2.5 },
  { id: MINE, key: 'mine', name: 'Мина', count: 6, value: 1.5 },
  { id: FLAG, key: 'flag', name: 'Знамя', count: 1, value: 100 },
];
export const RANK = Object.fromEntries(RANKS.map(r => [r.id, r]));
export const ARMY_SIZE = RANKS.reduce((s, r) => s + r.count, 0); // 40

export const idx = (r, c) => r * SIZE + c;
export const rowOf = i => Math.floor(i / SIZE);
export const colOf = i => i % SIZE;

const LAKES = new Set([idx(4, 2), idx(4, 3), idx(5, 2), idx(5, 3), idx(4, 6), idx(4, 7), idx(5, 6), idx(5, 7)]);
export const isLake = i => LAKES.has(i);

// Белые расставляются в рядах 6–9, синие — в рядах 0–3.
export const inHomeRows = (owner, i) => owner === WHITE ? rowOf(i) >= 6 : rowOf(i) <= 3;
export const homeCells = owner => {
  const out = [];
  for (let i = 0; i < SIZE * SIZE; i++) if (inHomeRows(owner, i)) out.push(i);
  return out;
};
// Глубина клетки в своей зоне: 0 — передний ряд, 3 — задний.
export const depth = (owner, i) => owner === WHITE ? rowOf(i) - 6 : 3 - rowOf(i);

export const isMovable = rank => rank >= 1 && rank <= 10;

export function neighbors(i) {
  const r = rowOf(i), c = colOf(i), out = [];
  if (r > 0) out.push(i - SIZE);
  if (r < SIZE - 1) out.push(i + SIZE);
  if (c > 0) out.push(i - 1);
  if (c < SIZE - 1) out.push(i + 1);
  return out.filter(n => !isLake(n));
}

// Исход атаки: 'att' — победил нападающий, 'def' — защитник, 'both' — погибли оба.
export function resolve(att, def) {
  if (def === FLAG) return 'att';
  if (def === MINE) return att === 8 ? 'att' : 'def';
  if (att === 10 && def === 1) return 'att';
  if (att === def) return 'both';
  return att < def ? 'att' : 'def';
}

// Перечень фишек армии по званиям (40 штук).
export function armyList() {
  const out = [];
  for (const r of RANKS) for (let k = 0; k < r.count; k++) out.push(r.id);
  return out;
}

// Ограничение повторов: одна фишка не может ходить туда-обратно между двумя клетками более трёх раз подряд.
export const MAX_SHUTTLE = 3;
// Ничья, если столько ходов подряд не было ни одного сражения.
export const NO_BATTLE_DRAW = 200;
