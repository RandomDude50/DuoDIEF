// Costruisce il payload dei risultati di una partita dal punto di vista di un utente.
// Usato sia a fine partita (socket) sia per riaprire una partita dallo storico (REST).
module.exports = function getMatchPayload(db, matchId, userId) {
  const match = db.prepare(
    `SELECT m.id, m.n_questions AS nQuestions, m.time_limit_s AS timeLimitS, m.started_at AS startedAt,
            m.ended_at AS endedAt, t.name AS topic
     FROM matches m JOIN topics t ON t.id = m.topic_id WHERE m.id = ?`
  ).get(matchId);
  if (!match) return null;

  const podium = db.prepare(
    `SELECT mp.user_id AS userId, u.username, mp.placement, mp.score, mp.correct_count AS correctCount,
            mp.total_questions AS total, mp.avg_time_ms AS avgTimeMs, mp.elo_before AS eloBefore, mp.elo_after AS eloAfter
     FROM match_players mp JOIN users u ON u.id = mp.user_id
     WHERE mp.match_id = ? ORDER BY mp.placement ASC, mp.score DESC`
  ).all(matchId);
  if (!podium.some(p => p.userId === userId)) return null;

  const answers = db.prepare(
    `SELECT ma.position, q.text, q.options, q.correct_index AS correctIndex, q.explanation,
            ma.chosen_index AS chosenIndex, ma.is_correct AS isCorrect, ma.time_ms AS timeMs, ma.points
     FROM match_answers ma JOIN questions q ON q.id = ma.question_id
     WHERE ma.match_id = ? AND ma.user_id = ? ORDER BY ma.position ASC`
  ).all(matchId, userId).map(a => ({ ...a, options: JSON.parse(a.options), isCorrect: !!a.isCorrect }));

  return { match, podium, me: { userId, answers } };
};
