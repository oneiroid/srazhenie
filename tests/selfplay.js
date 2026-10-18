// AI против AI: проверка, что движок и ИИ доигрывают партии без ошибок.
import { Game, randomLayout } from '../js/game.js';
import { aiLayout, aiMove } from '../js/ai.js';
import { WHITE, BLUE, armyList } from '../js/rules.js';

const N = +(process.argv[2] || 50);
const levels = [process.argv[3] || 'normal', process.argv[4] || 'easy'];
const stats = { wins: [0, 0], draw: 0, reasons: {}, plies: 0 };
for (let g = 0; g < N; g++) {
  const game = new Game();
  for (const o of [WHITE, BLUE]) {
    const lay = aiLayout(o);
    const ranks = lay.map(x => x[1]).sort((a, b) => a - b).join();
    if (ranks !== armyList().sort((a, b) => a - b).join() || new Set(lay.map(x => x[0])).size !== 40) throw new Error('bad layout');
    game.placeArmy(o, lay);
  }
  game.start();
  while (game.phase === 'play') {
    const m = aiMove(game, game.turn, levels[game.turn]);
    if (!m) throw new Error('no move but game in play');
    game.move(m[0], m[1]);
    // Сериализация должна сохранять состояние.
    if (game.history.length % 97 === 0) Object.assign(game, new Game(JSON.parse(JSON.stringify(game))));
  }
  stats.plies += game.history.length;
  if (game.winner == null) stats.draw++; else stats.wins[game.winner]++;
  stats.reasons[game.reason] = (stats.reasons[game.reason] || 0) + 1;
}
console.log(`levels white=${levels[0]} blue=${levels[1]}`, stats, 'avg plies', (stats.plies / N).toFixed(0));
