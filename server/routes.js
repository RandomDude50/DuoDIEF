const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const getMatchPayload = require('./matchData');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
if (!process.env.JWT_SECRET) console.warn('[warn] JWT_SECRET non impostato: uso un segreto di sviluppo.');

const router = express.Router();

function signToken(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    const { id } = jwt.verify(token, JWT_SECRET);
    // Il ruolo viene riletto a ogni richiesta: una revoca ha effetto subito.
    return db.prepare('SELECT id, username, email, elo, role, created_at FROM users WHERE id = ?').get(id) || null;
  } catch { return null; }
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const user = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  req.user = user;
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Riservato agli admin' });
  next();
}

const publicUser = u => ({ id: u.id, username: u.username, email: u.email, elo: u.elo, role: u.role, createdAt: u.created_at });

// Validazione di una domanda (creazione e modifica). Restituisce { error } oppure { value }.
function checkQuestion(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.text !== undefined) {
    const text = String(body.text ?? '').trim();
    if (!text) return { error: 'Il testo della domanda è obbligatorio' };
    out.text = text;
  }
  if (!partial || body.options !== undefined) {
    const opts = Array.isArray(body.options) ? body.options.map(o => String(o).trim()) : null;
    if (!opts || opts.length !== 4 || opts.some(o => !o)) return { error: 'Servono esattamente 4 opzioni non vuote' };
    out.options = JSON.stringify(opts);
  }
  if (!partial || body.correctIndex !== undefined) {
    const ci = Number(body.correctIndex);
    if (!Number.isInteger(ci) || ci < 0 || ci > 3) return { error: 'La risposta corretta deve essere 0-3' };
    out.correct_index = ci;
  }
  if (body.explanation !== undefined) out.explanation = String(body.explanation ?? '').trim() || null;
  if (body.active !== undefined) out.active = body.active ? 1 : 0;
  return { value: out };
}

// Costruisce un UPDATE dinamico su una tabella a partire dai campi validati.
function updateRow(table, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return 0;
  return db.prepare(`UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map(k => fields[k]), id).changes;
}

// ---------- Auth ----------
router.post('/auth/signup', (req, res) => {
  const { username = '', email = '', password = '' } = req.body || {};
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username: 3-20 caratteri (lettere, numeri, _)' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email non valida' });
  if (password.length < 6) return res.status(400).json({ error: 'La password deve avere almeno 6 caratteri' });
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ? OR email = ?').get(username, email);
  if (exists) return res.status(409).json({ error: 'Username o email già in uso' });
  const hash = bcrypt.hashSync(password, 10);
  const id = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?,?,?)').run(username, email, hash).lastInsertRowid;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.post('/auth/login', (req, res) => {
  const { identifier = '', password = '' } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(identifier, identifier);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Credenziali errate' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

// ---------- Dati ----------
router.get('/topics', auth, (req, res) => {
  res.json(db.prepare(
    `SELECT t.id, t.name, COUNT(q.id) AS questions
     FROM topics t LEFT JOIN questions q ON q.topic_id = t.id AND q.active = 1
     WHERE t.active = 1 GROUP BY t.id ORDER BY t.name`
  ).all());
});

router.get('/me', auth, (req, res) => {
  const u = req.user;
  const stats = db.prepare(
    `SELECT COUNT(*) AS played,
            COALESCE(SUM(placement = 1), 0) AS wins,
            COALESCE(SUM(correct_count), 0) AS correct,
            COALESCE(SUM(total_questions), 0) AS total,
            COALESCE(AVG(avg_time_ms), 0) AS avgTimeMs
     FROM match_players WHERE user_id = ?`
  ).get(u.id);
  const rank = db.prepare('SELECT COUNT(*) + 1 AS rank FROM users WHERE elo > ?').get(u.elo).rank;
  const history = db.prepare(
    `SELECT m.id AS matchId, t.name AS topic, m.ended_at AS endedAt, mp.placement, mp.score,
            mp.correct_count AS correctCount, mp.total_questions AS total, mp.elo_before AS eloBefore, mp.elo_after AS eloAfter,
            (SELECT COUNT(*) FROM match_players WHERE match_id = m.id) AS players
     FROM match_players mp JOIN matches m ON m.id = mp.match_id JOIN topics t ON t.id = m.topic_id
     WHERE mp.user_id = ? ORDER BY m.id DESC LIMIT 20`
  ).all(u.id);
  res.json({
    user: publicUser(u),
    rank,
    stats: {
      played: stats.played,
      wins: stats.wins,
      losses: stats.played - stats.wins,
      accuracy: stats.total ? stats.correct / stats.total : 0,
      avgTimeMs: Math.round(stats.avgTimeMs)
    },
    history
  });
});

router.get('/leaderboard', auth, (req, res) => {
  res.json(db.prepare(
    `SELECT u.id, u.username, u.elo,
            (SELECT COUNT(*) FROM match_players WHERE user_id = u.id) AS played,
            (SELECT COUNT(*) FROM match_players WHERE user_id = u.id AND placement = 1) AS wins
     FROM users u ORDER BY u.elo DESC, u.id ASC LIMIT 50`
  ).all());
});

router.get('/matches/:id', auth, (req, res) => {
  const payload = getMatchPayload(db, Number(req.params.id), req.user.id);
  if (!payload) return res.status(404).json({ error: 'Partita non trovata' });
  res.json(payload);
});

// ---------- Admin: gestione quiz (cancellazione sempre soft: active = 0) ----------
const admin = express.Router();
admin.use(auth, adminOnly);

admin.get('/topics', (req, res) => {
  res.json(db.prepare(
    `SELECT t.id, t.name, t.active,
            COUNT(q.id) AS questions,
            COALESCE(SUM(q.active), 0) AS activeQuestions
     FROM topics t LEFT JOIN questions q ON q.topic_id = t.id
     GROUP BY t.id ORDER BY t.name`
  ).all());
});

admin.post('/topics', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Nome: 2-40 caratteri' });
  if (db.prepare('SELECT 1 FROM topics WHERE name = ?').get(name)) return res.status(409).json({ error: 'Topic già esistente' });
  const id = db.prepare('INSERT INTO topics (name) VALUES (?)').run(name).lastInsertRowid;
  res.status(201).json({ id, name, active: 1 });
});

admin.patch('/topics/:id', (req, res) => {
  const fields = {};
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Nome: 2-40 caratteri' });
    if (db.prepare('SELECT 1 FROM topics WHERE name = ? AND id != ?').get(name, req.params.id)) return res.status(409).json({ error: 'Topic già esistente' });
    fields.name = name;
  }
  if (req.body?.active !== undefined) fields.active = req.body.active ? 1 : 0;
  if (!updateRow('topics', req.params.id, fields)) return res.status(404).json({ error: 'Topic non trovato' });
  res.json({ ok: true });
});

// "Elimina" un topic: lo disattiva. Le partite storiche continuano a mostrarlo.
admin.delete('/topics/:id', (req, res) => {
  if (!updateRow('topics', req.params.id, { active: 0 })) return res.status(404).json({ error: 'Topic non trovato' });
  res.json({ ok: true });
});

admin.get('/topics/:id/questions', (req, res) => {
  const rows = db.prepare(
    'SELECT id, text, options, correct_index AS correctIndex, explanation, active FROM questions WHERE topic_id = ? ORDER BY id'
  ).all(req.params.id);
  res.json(rows.map(r => ({ ...r, options: JSON.parse(r.options) })));
});

admin.post('/questions', (req, res) => {
  const { error, value } = checkQuestion(req.body || {});
  if (error) return res.status(400).json({ error });
  const topic = db.prepare('SELECT id FROM topics WHERE id = ?').get(Number(req.body.topicId));
  if (!topic) return res.status(400).json({ error: 'Topic non valido' });
  const id = db.prepare(
    'INSERT INTO questions (topic_id, text, options, correct_index, explanation, active) VALUES (?,?,?,?,?,1)'
  ).run(topic.id, value.text, value.options, value.correct_index, value.explanation ?? null).lastInsertRowid;
  res.status(201).json({ id });
});

admin.patch('/questions/:id', (req, res) => {
  const { error, value } = checkQuestion(req.body || {}, { partial: true });
  if (error) return res.status(400).json({ error });
  if (!updateRow('questions', req.params.id, value)) return res.status(404).json({ error: 'Domanda non trovata' });
  res.json({ ok: true });
});

// "Elimina" una domanda: la disattiva. Le risposte storiche in match_answers restano valide.
admin.delete('/questions/:id', (req, res) => {
  if (!updateRow('questions', req.params.id, { active: 0 })) return res.status(404).json({ error: 'Domanda non trovata' });
  res.json({ ok: true });
});

router.use('/admin', admin);

module.exports = { router, verifyToken };
