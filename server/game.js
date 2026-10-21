const db = require('./db');
const { verifyToken } = require('./routes');
const { computeEloChanges } = require('./elo');
const getMatchPayload = require('./matchData');

const REVEAL_MS = Number(process.env.REVEAL_MS) || 4500;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;

const rooms = new Map();            // code -> room
const userSockets = new Map();      // userId -> Set<socket>

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

const roomOfUser = userId => [...rooms.values()].find(r => r.players.has(userId));
const isOnline = userId => (userSockets.get(userId)?.size || 0) > 0;

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    topic: room.topic,
    nQuestions: room.nQuestions,
    timeLimit: room.timeLimit,
    status: room.status,
    maxPlayers: MAX_PLAYERS,
    players: [...room.players.values()].map(p => ({ userId: p.userId, username: p.username, elo: p.elo, connected: isOnline(p.userId) }))
  };
}

function emitToUser(userId, event, payload) {
  for (const s of userSockets.get(userId) || []) s.emit(event, payload);
}

function broadcastRoom(io, room) {
  io.to(room.code).emit('room:state', publicRoom(room));
}

function destroyRoom(io, room, reason) {
  clearTimeout(room.timer);
  clearTimeout(room.nextTimer);
  rooms.delete(room.code);
  for (const p of room.players.values()) {
    for (const s of userSockets.get(p.userId) || []) {
      s.leave(room.code);
      s.data.roomCode = null;
    }
  }
  if (reason) io.to(room.code).emit('room:closed', { reason });
}

// ---------- Flusso di gioco ----------
function startGame(io, room) {
  // Sorteggio unico, lato server: tutti i giocatori ricevono le stesse domande in questo ordine.
  const rows = db.prepare('SELECT * FROM questions WHERE topic_id = ? AND active = 1 ORDER BY RANDOM() LIMIT ?').all(room.topic.id, room.nQuestions);
  room.questions = rows.map(r => ({ ...r, options: JSON.parse(r.options) }));
  room.nQuestions = room.questions.length;
  room.status = 'playing';
  room.startedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  room.qIndex = -1;
  for (const p of room.players.values()) { p.score = 0; p.answers = []; }
  broadcastRoom(io, room);
  nextQuestion(io, room);
}

function questionPayload(room) {
  const q = room.questions[room.qIndex];
  const limitMs = room.timeLimit * 1000;
  return {
    index: room.qIndex,
    total: room.questions.length,
    category: room.topic.name,
    text: q.text,
    options: q.options,
    timeLimitMs: limitMs,
    remainingMs: Math.max(0, limitMs - (Date.now() - room.current.startedAt))
  };
}

function nextQuestion(io, room) {
  room.qIndex++;
  if (room.qIndex >= room.questions.length) return finishGame(io, room);
  room.current = { startedAt: Date.now(), open: true, answered: new Set() };
  io.to(room.code).emit('game:question', questionPayload(room));
  clearTimeout(room.timer);
  room.timer = setTimeout(() => reveal(io, room), room.timeLimit * 1000 + 400); // 400ms di tolleranza rete
}

function connectedPlayers(room) {
  return [...room.players.values()].filter(p => isOnline(p.userId));
}

function handleAnswer(io, socket, index) {
  const room = rooms.get(socket.data.roomCode);
  if (!room || room.status !== 'playing' || !room.current?.open) return;
  const player = room.players.get(socket.data.user.id);
  if (!player || room.current.answered.has(player.userId)) return;
  if (!Number.isInteger(index) || index < 0 || index > 3) return;

  const limitMs = room.timeLimit * 1000;
  const timeMs = Math.min(limitMs, Date.now() - room.current.startedAt);
  const q = room.questions[room.qIndex];
  const isCorrect = index === q.correct_index;
  // 500 punti per la risposta corretta + fino a 500 di bonus velocità
  const points = isCorrect ? Math.round(500 + 500 * (1 - timeMs / limitMs)) : 0;
  player.score += points;
  player.answers[room.qIndex] = { questionId: q.id, chosenIndex: index, isCorrect, timeMs, points };
  room.current.answered.add(player.userId);

  const online = connectedPlayers(room);
  io.to(room.code).emit('game:answered', {
    answered: online.filter(p => room.current.answered.has(p.userId)).length,
    total: online.length
  });
  if (online.every(p => room.current.answered.has(p.userId))) reveal(io, room);
}

function scoreboard(room) {
  return [...room.players.values()]
    .map(p => ({ userId: p.userId, username: p.username, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function reveal(io, room) {
  if (!room.current?.open) return;
  room.current.open = false;
  clearTimeout(room.timer);
  const q = room.questions[room.qIndex];
  const limitMs = room.timeLimit * 1000;

  const round = [];
  for (const p of room.players.values()) {
    if (!p.answers[room.qIndex]) {
      p.answers[room.qIndex] = { questionId: q.id, chosenIndex: null, isCorrect: false, timeMs: limitMs, points: 0 };
    }
    const a = p.answers[room.qIndex];
    round.push({ userId: p.userId, chosenIndex: a.chosenIndex, isCorrect: a.isCorrect, points: a.points });
  }

  io.to(room.code).emit('game:reveal', {
    index: room.qIndex,
    correctIndex: q.correct_index,
    explanation: q.explanation,
    round,
    scoreboard: scoreboard(room),
    last: room.qIndex === room.questions.length - 1
  });
  room.nextTimer = setTimeout(() => nextQuestion(io, room), REVEAL_MS);
}

function finishGame(io, room) {
  room.status = 'finished';
  const limitMs = room.timeLimit * 1000;
  const n = room.questions.length;

  const stats = [...room.players.values()].map(p => {
    const correct = p.answers.filter(a => a.isCorrect).length;
    const avgTime = Math.round(p.answers.reduce((s, a) => s + a.timeMs, 0) / n);
    return { p, correct, avgTime };
  });
  // Ordinamento: punti, poi risposte corrette, poi tempo medio più basso
  stats.sort((a, b) => b.p.score - a.p.score || b.correct - a.correct || a.avgTime - b.avgTime);
  stats.forEach((s, i) => {
    s.placement = i > 0 && s.p.score === stats[i - 1].p.score ? stats[i - 1].placement : i + 1;
  });

  const current = new Map(db.prepare(`SELECT id, elo FROM users WHERE id IN (${stats.map(() => '?').join(',')})`).all(...stats.map(s => s.p.userId)).map(u => [u.id, u.elo]));
  const elo = computeEloChanges(stats.map(s => ({
    id: s.p.userId,
    elo: current.get(s.p.userId),
    placement: s.placement,
    accuracy: s.correct / n,
    speed: Math.min(1, Math.max(0, 1 - s.avgTime / limitMs))
  })));

  const matchId = db.transaction(() => {
    const id = db.prepare('INSERT INTO matches (topic_id, n_questions, time_limit_s, started_at) VALUES (?,?,?,?)')
      .run(room.topic.id, n, room.timeLimit, room.startedAt).lastInsertRowid;
    const insP = db.prepare('INSERT INTO match_players (match_id, user_id, placement, score, correct_count, total_questions, avg_time_ms, elo_before, elo_after) VALUES (?,?,?,?,?,?,?,?,?)');
    const insA = db.prepare('INSERT INTO match_answers (match_id, user_id, question_id, position, chosen_index, is_correct, time_ms, points) VALUES (?,?,?,?,?,?,?,?)');
    const updU = db.prepare('UPDATE users SET elo = ? WHERE id = ?');
    for (const s of stats) {
      const e = elo[s.p.userId];
      insP.run(id, s.p.userId, s.placement, s.p.score, s.correct, n, s.avgTime, current.get(s.p.userId), e.newElo);
      s.p.answers.forEach((a, pos) => insA.run(id, s.p.userId, a.questionId, pos, a.chosenIndex, a.isCorrect ? 1 : 0, a.timeMs, a.points));
      updU.run(e.newElo, s.p.userId);
    }
    return id;
  })();

  for (const s of stats) emitToUser(s.p.userId, 'game:over', getMatchPayload(db, matchId, s.p.userId));
  destroyRoom(io, room);
}

// ---------- Socket.IO ----------
function attach(io) {
  io.use((socket, next) => {
    const user = verifyToken(socket.handshake.auth?.token || '');
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = { id: user.id, username: user.username };
    next();
  });

  io.on('connection', socket => {
    const user = socket.data.user;
    if (!userSockets.has(user.id)) userSockets.set(user.id, new Set());
    userSockets.get(user.id).add(socket);

    // Riconnessione a una stanza già esistente
    const existing = roomOfUser(user.id);
    if (existing) {
      socket.join(existing.code);
      socket.data.roomCode = existing.code;
      socket.emit('room:state', publicRoom(existing));
      if (existing.status === 'playing' && existing.current?.open) socket.emit('game:question', questionPayload(existing));
      broadcastRoom(io, existing);
    }

    socket.on('room:create', (opts = {}, cb = () => {}) => {
      const current = roomOfUser(user.id);
      if (current) {
        if (current.status === 'playing') return cb({ error: 'Sei già in una partita in corso' });
        leaveRoom(io, socket);
      }
      const topic = db.prepare('SELECT id, name FROM topics WHERE id = ? AND active = 1').get(Number(opts.topicId));
      if (!topic) return cb({ error: 'Topic non valido' });
      const available = db.prepare('SELECT COUNT(*) AS c FROM questions WHERE topic_id = ? AND active = 1').get(topic.id).c;
      if (available === 0) return cb({ error: 'Nessuna domanda disponibile in questo topic' });
      const nQuestions = Math.min(clamp(Number(opts.nQuestions), 3, 20), available);
      const timeLimit = clamp(Number(opts.timeLimit), 5, 30);
      const dbUser = db.prepare('SELECT elo FROM users WHERE id = ?').get(user.id);
      const room = {
        code: genCode(), hostId: user.id, topic, nQuestions, timeLimit, status: 'lobby',
        players: new Map([[user.id, { userId: user.id, username: user.username, elo: dbUser.elo, score: 0, answers: [] }]])
      };
      rooms.set(room.code, room);
      socket.join(room.code);
      socket.data.roomCode = room.code;
      broadcastRoom(io, room);
      cb({ ok: true, code: room.code });
    });

    socket.on('room:join', (opts = {}, cb = () => {}) => {
      const code = String(opts.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return cb({ error: 'Stanza non trovata' });
      if (room.players.has(user.id)) { // già dentro (es. altra scheda): riaggancia
        socket.join(code); socket.data.roomCode = code;
        socket.emit('room:state', publicRoom(room));
        return cb({ ok: true });
      }
      if (room.status !== 'lobby') return cb({ error: 'La partita è già iniziata' });
      if (room.players.size >= MAX_PLAYERS) return cb({ error: 'Stanza piena' });
      const other = roomOfUser(user.id);
      if (other) {
        if (other.status === 'playing') return cb({ error: 'Sei già in una partita in corso' });
        leaveRoom(io, socket);
      }
      const dbUser = db.prepare('SELECT elo FROM users WHERE id = ?').get(user.id);
      room.players.set(user.id, { userId: user.id, username: user.username, elo: dbUser.elo, score: 0, answers: [] });
      socket.join(code);
      socket.data.roomCode = code;
      broadcastRoom(io, room);
      cb({ ok: true });
    });

    socket.on('room:invite', (opts = {}, cb = () => {}) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.status !== 'lobby') return cb({ error: 'Nessuna lobby attiva' });
      const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(String(opts.username || '').trim());
      if (!target) return cb({ error: 'Utente non trovato' });
      if (target.id === user.id) return cb({ error: 'Non puoi invitare te stesso' });
      if (!isOnline(target.id)) return cb({ error: `${target.username} non è online` });
      emitToUser(target.id, 'invite:received', { code: room.code, from: user.username, topic: room.topic.name });
      cb({ ok: true });
    });

    socket.on('room:start', (_o, cb = () => {}) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.status !== 'lobby') return cb({ error: 'Nessuna lobby attiva' });
      if (room.hostId !== user.id) return cb({ error: 'Solo l\'host può avviare' });
      if (room.players.size < MIN_PLAYERS) return cb({ error: `Servono almeno ${MIN_PLAYERS} giocatori` });
      startGame(io, room);
      cb({ ok: true });
    });

    socket.on('room:leave', (_o, cb = () => {}) => {
      const room = rooms.get(socket.data.roomCode);
      if (room && room.status === 'playing') return cb({ error: 'Partita in corso' });
      leaveRoom(io, socket);
      cb({ ok: true });
    });

    socket.on('answer', ({ index } = {}) => handleAnswer(io, socket, index));

    socket.on('disconnect', () => {
      userSockets.get(user.id)?.delete(socket);
      if (!isOnline(user.id)) userSockets.delete(user.id);
      const room = rooms.get(socket.data.roomCode);
      if (!room) return;
      if (isOnline(user.id)) return; // altra scheda ancora aperta
      if (room.status === 'lobby') return leaveRoom(io, socket);
      if (room.status === 'playing') {
        const online = connectedPlayers(room);
        if (online.length === 0) return destroyRoom(io, room);
        broadcastRoom(io, room);
        if (room.current?.open && online.every(p => room.current.answered.has(p.userId))) reveal(io, room);
      }
    });
  });
}

function leaveRoom(io, socket) {
  const room = rooms.get(socket.data.roomCode);
  const userId = socket.data.user.id;
  if (!room) return;
  room.players.delete(userId);
  socket.leave(room.code);
  socket.data.roomCode = null;
  if (room.players.size === 0) return destroyRoom(io, room);
  if (room.hostId === userId) room.hostId = room.players.keys().next().value;
  broadcastRoom(io, room);
}

module.exports = { attach };
