// ELO performance-based per partite con 2+ giocatori.
//
// Delta = componente di piazzamento + componente di performance
//  - Piazzamento: ELO classico a confronti a coppie (ogni giocatore vs ogni altro),
//    normalizzato su (n-1) così il peso totale è paragonabile tra 1v1 e multiplayer.
//  - Performance: perf = 0.7*accuratezza + 0.3*velocità (0..1). Perf 0.5 = neutro,
//    sopra dà un bonus fino a +KP, sotto una penalità fino a -KP.
//    Così chi vince giocando male guadagna meno, chi perde giocando bene perde meno.
const K = 32;
const KP = 12;
const MIN_ELO = 100;

function expected(a, b) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/**
 * @param {{id:number, elo:number, placement:number, accuracy:number, speed:number}[]} players
 * @returns {Record<number, {delta:number, newElo:number}>}
 */
function computeEloChanges(players) {
  const n = players.length;
  const out = {};
  for (const p of players) {
    let sum = 0;
    for (const q of players) {
      if (q === p) continue;
      const s = p.placement < q.placement ? 1 : p.placement === q.placement ? 0.5 : 0;
      sum += s - expected(p.elo, q.elo);
    }
    const placeDelta = n > 1 ? (K * sum) / (n - 1) : 0;
    const perf = 0.7 * p.accuracy + 0.3 * p.speed;
    const perfDelta = n > 1 ? KP * (perf - 0.5) * 2 : 0;
    const delta = Math.round(placeDelta + perfDelta);
    out[p.id] = { delta, newElo: Math.max(MIN_ELO, p.elo + delta) };
  }
  return out;
}

module.exports = { computeEloChanges, expected, K, KP };
