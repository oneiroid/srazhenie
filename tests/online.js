// Две сетевые партии, связанные каналом в памяти; ходы выбирает ИИ. Проверяет протокол обязательств,
// раскрытие званий в бою, итоговую проверку честности и реванш.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
const { OnlineMatch } = await import('../js/online.js');
const { aiLayout, aiMove } = await import('../js/ai.js');

const ui = { update() {}, animated: async () => {}, gameOver() {}, netStatus() {}, closeDialogs() {} };

function link(a, b) {
  const mk = (to) => ({ send: m => { const copy = JSON.parse(JSON.stringify(m)); setTimeout(() => { to.q = to.q.then(() => to.handle(copy)); }, 0); }, stop() {} });
  a.chan = mk(b);
  b.chan = mk(a);
}
const tick = () => new Promise(r => setTimeout(r, 0));
async function settle(ms = 5) { for (let k = 0; k < ms; k++) await tick(); await host.q; await guest.q; for (let k = 0; k < ms; k++) await tick(); }

let host, guest;
const N = +(process.argv[2] || 5);
let games = 0;
host = new OnlineMatch(null, { role: 'host', color: 1 }, ui);
guest = new OnlineMatch(null, { role: 'guest', room: host.room }, ui);
link(host, guest);
guest.chan.send({ t: 'join' });
await settle();
if (host.stage !== 'setup' || guest.stage !== 'setup' || guest.st.myColor !== 0) throw new Error('handshake failed');

for (let gi = 0; gi < N; gi++) {
  for (const m of [host, guest]) await m.submitSetup(aiLayout(m.st.myColor));
  await settle();
  if (host.stage !== 'play' || guest.stage !== 'play') throw new Error('did not start: ' + host.stage + guest.stage);
  // Звания соперника скрыты.
  if (host.game.army(guest.st.myColor).some(p => p.rank != null)) throw new Error('ranks leaked');
  let plies = 0;
  while (host.stage === 'play' || guest.stage === 'play') {
    const m = [host, guest].find(x => x.canMove());
    if (!m) { await settle(); if (++plies > 5000) throw new Error('stuck'); continue; }
    const mv = aiMove(m.game, m.st.myColor, 'normal');
    await m.move(mv[0], mv[1]);
    await settle();
    plies++;
    if (plies > 4000) throw new Error('too long');
    // Позиции на обеих сторонах совпадают.
    const ph = host.game.pieces.map(p => p.alive ? p.pos : -9).join(), pg = guest.game.pieces.map(p => p.alive ? p.pos : -9).join();
    if (ph !== pg) throw new Error('desync at ply ' + plies);
  }
  await settle(20);
  for (const m of [host, guest]) {
    if (!m.st.verify || !m.st.verify.ok) throw new Error('verify failed: ' + JSON.stringify(m.st.verify));
  }
  if (host.game.winner !== guest.game.winner) throw new Error('winner mismatch');
  console.log(`game ${gi + 1}: ${host.game.reason} winner=${host.game.winner} plies=${host.game.history.length} verify=ok`);
  games++;
  host.requestRematch(); guest.requestRematch();
  await settle();
  if (host.stage !== 'setup' || guest.stage !== 'setup' || host.st.myColor === guest.st.myColor) throw new Error('rematch failed');
}

// Подмена звания должна обнаруживаться.
for (const m of [host, guest]) await m.submitSetup(aiLayout(m.st.myColor));
await settle();
const cheater = [host, guest].find(x => x.canMove());
const honest = cheater === host ? guest : host;
const fakeId = cheater.game.army(cheater.st.myColor).find(p => p.rank !== 1).id;
cheater.st.secrets[fakeId][0] = 1; // «это маршал»
const victim = honest.game.army(honest.st.myColor)[0];
// Прямо отправляем атаку с поддельным раскрытием.
honest.handle({ t: 'move', g: honest.st.gameId, n: honest.game.history.length, from: cheater.game.pieces[fakeId].pos, to: victim.pos, reveal: { id: fakeId, rank: 1, salt: cheater.st.secrets[fakeId][1] } });
await settle();
if (!honest.st.verify || honest.st.verify.ok) throw new Error('cheat not detected');
console.log('cheat detected:', honest.st.verify.text);
console.log(`OK: ${games} online games`);
