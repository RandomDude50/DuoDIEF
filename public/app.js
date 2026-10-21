/* QuizDuel client: vanilla JS, SPA a viste con Socket.IO */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LETTERS = ['A', 'B', 'C', 'D'];

const S = { token: localStorage.getItem('qd_token'), user: null, socket: null, room: null, game: null, soundOn: true, signup: false };

// ---------- API ----------
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || 'Errore'); e.status = r.status; throw e; }
  return d;
}

// ---------- Viste ----------
const VIEWS = ['auth', 'home', 'lobby', 'game', 'results', 'leaderboard', 'admin'];
function show(name) {
  VIEWS.forEach(v => $('#view-' + v).classList.toggle('hidden-view', v !== name));
  $('#appHeader').classList.toggle('hidden-view', name === 'auth');
  S.view = name;
}

// ---------- Tema ----------
const PRESETS = [['#8b5cf6', '#ec4899'], ['#10b981', '#06b6d4'], ['#f59e0b', '#ef4444'], ['#3b82f6', '#8b5cf6'], ['#ec4899', '#f43f5e']];
function setTheme(a, b, btn) {
  const rgb = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)).join(',');
  const r = document.documentElement.style;
  r.setProperty('--primary-hex', a); r.setProperty('--primary-light', a); r.setProperty('--secondary-accent', b);
  r.setProperty('--primary-glow', `rgba(${rgb},.45)`); r.setProperty('--primary-glow-strong', `rgba(${rgb},.75)`);
  r.setProperty('--primary-bg-alpha', `rgba(${rgb},.18)`);
  r.setProperty('--primary-gradient', `linear-gradient(135deg, ${a} 0%, ${b} 100%)`);
  document.querySelectorAll('.preset-btn').forEach(x => x.classList.toggle('active', x === btn));
  localStorage.setItem('qd_theme', JSON.stringify([a, b]));
}
PRESETS.forEach(([a, b]) => {
  const btn = document.createElement('button');
  btn.className = 'preset-btn'; btn.style.background = `linear-gradient(135deg, ${a}, ${b})`;
  btn.onclick = () => setTheme(a, b, btn);
  $('#presets').appendChild(btn);
});
try { const t = JSON.parse(localStorage.getItem('qd_theme')); if (t) setTheme(t[0], t[1]); } catch {}

// ---------- Suoni (Web Audio, nessun asset) ----------
let audioCtx;
function beep(freqs, dur = 0.12, type = 'triangle', vol = 0.12) {
  if (!S.soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    freqs.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + i * dur;
      o.type = type; o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur * 1.5);
      o.start(t); o.stop(t + dur * 1.5);
    });
  } catch {}
}
const sfx = {
  click: () => beep([800], 0.05, 'sine', 0.05),
  correct: () => beep([523, 659, 784], 0.1),
  wrong: () => beep([180, 110], 0.15, 'sawtooth'),
  finish: () => beep([440, 554, 659, 880], 0.12),
  tick: () => beep([1000], 0.04, 'square', 0.04)
};
$('#soundBtn').onclick = () => { S.soundOn = !S.soundOn; $('#soundBtn').textContent = S.soundOn ? '🔊' : '🔇'; sfx.click(); };

// ---------- Toast ----------
function toast(html, { actions = [], ms = 8000 } = {}) {
  const el = document.createElement('div');
  el.className = 'glass-card rounded-2xl p-3 text-sm';
  el.innerHTML = `<div>${html}</div>`;
  if (actions.length) {
    const row = document.createElement('div'); row.className = 'flex gap-2 mt-2';
    actions.forEach(a => {
      const b = document.createElement('button');
      b.className = a.primary ? 'btn-gradient rounded-lg px-3 py-1 text-xs font-bold' : 'btn-ghost rounded-lg px-3 py-1 text-xs';
      b.textContent = a.label; b.onclick = () => { a.onClick(); el.remove(); }; row.appendChild(b);
    });
    el.appendChild(row);
  }
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- Auth ----------
function renderAuthMode() {
  $('#fEmail').classList.toggle('hidden-view', !S.signup);
  $('#fEmail').required = S.signup;
  $('#fUsername').placeholder = S.signup ? 'Username' : 'Username o email';
  $('#authSubmit').textContent = S.signup ? 'Registrati' : 'Accedi';
  $('#authToggle').textContent = S.signup ? 'Hai già un account? Accedi' : 'Non hai un account? Registrati';
  $('#authError').textContent = '';
}
$('#authToggle').onclick = () => { S.signup = !S.signup; renderAuthMode(); };
$('#authForm').onsubmit = async e => {
  e.preventDefault();
  $('#authError').textContent = '';
  try {
    const body = S.signup
      ? { username: $('#fUsername').value.trim(), email: $('#fEmail').value.trim(), password: $('#fPassword').value }
      : { identifier: $('#fUsername').value.trim(), password: $('#fPassword').value };
    const d = await api(S.signup ? '/auth/signup' : '/auth/login', { method: 'POST', body });
    S.token = d.token; localStorage.setItem('qd_token', d.token);
    await boot();
  } catch (err) { $('#authError').textContent = err.message; }
};
function logout() {
  localStorage.removeItem('qd_token'); S.token = null; S.user = null;
  S.socket?.disconnect(); S.socket = null; S.room = null;
  show('auth');
}
$('#logoutBtn').onclick = logout;

// ---------- Home ----------
async function loadHome() {
  const [me, topics] = await Promise.all([api('/me'), api('/topics')]);
  S.user = me.user;
  $('#adminBtn').classList.toggle('hidden-view', me.user.role !== 'admin');
  $('#hdrUser').textContent = me.user.username;
  $('#hdrElo').textContent = me.user.elo;
  $('#rankBadge').textContent = `#${me.rank} in classifica`;
  const st = me.stats;
  const tiles = [
    ['ELO', me.user.elo, 'text-amber-300'], ['Partite', st.played, 'text-white'],
    ['Vittorie', st.wins, 'text-emerald-400'], ['Sconfitte', st.losses, 'text-rose-400'],
    ['Accuratezza', Math.round(st.accuracy * 100) + '%', 'theme-text-primary']
  ];
  $('#statsGrid').innerHTML = tiles.map(([l, v, c]) =>
    `<div class="bg-slate-900/60 border border-slate-800 p-3 rounded-2xl text-center"><span class="block text-xs text-slate-400 mb-1 font-medium">${l}</span><span class="font-heading font-bold text-xl ${c}">${v}</span></div>`).join('');
  $('#selTopic').innerHTML = topics.map(t => `<option value="${t.id}">${esc(t.name)} (${t.questions})</option>`).join('');
  $('#history').innerHTML = me.history.length ? me.history.map(h => {
    const d = h.eloAfter - h.eloBefore;
    return `<button data-m="${h.matchId}" class="hist w-full text-left flex items-center justify-between gap-3 bg-slate-900/50 hover:bg-slate-800/70 border border-slate-800 rounded-xl px-4 py-3">
      <div><div class="font-semibold text-sm">${esc(h.topic)} <span class="text-slate-400 font-normal">· ${h.placement}° su ${h.players}</span></div>
      <div class="text-xs text-slate-400">${h.correctCount}/${h.total} corrette · ${h.score} pt · ${esc(h.endedAt)}</div></div>
      <span class="font-heading font-bold ${d >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${d >= 0 ? '+' : ''}${d}</span></button>`;
  }).join('') : '<p class="text-slate-400 text-sm">Nessuna partita ancora. Crea la prima sfida!</p>';
  document.querySelectorAll('.hist').forEach(b => b.onclick = async () => {
    try { renderResults(await api('/matches/' + b.dataset.m), { fromHistory: true }); } catch (e) { toast(esc(e.message)); }
  });
  show('home');
}
$('#logoBtn').onclick = () => { if (!['game', 'lobby'].includes(S.view)) loadHome(); };

$('#createBtn').onclick = () => {
  sfx.click(); $('#createError').textContent = '';
  S.socket.emit('room:create', { topicId: $('#selTopic').value, nQuestions: $('#selN').value, timeLimit: $('#selTime').value },
    r => r.error && ($('#createError').textContent = r.error));
};
$('#joinBtn').onclick = () => joinRoom($('#joinCode').value, e => $('#joinError').textContent = e);
function joinRoom(code, onError = e => toast(esc(e))) {
  sfx.click();
  S.socket.emit('room:join', { code }, r => r.error && onError(r.error));
}

// ---------- Lobby ----------
function renderLobby(room) {
  S.room = room;
  const isHost = room.hostId === S.user.id;
  $('#lobbyCode').textContent = room.code;
  $('#lobbyInfo').textContent = `${room.topic.name} · ${room.nQuestions} domande · ${room.timeLimit}s a domanda`;
  $('#lobbyCount').textContent = `(${room.players.length}/${room.maxPlayers})`;
  $('#lobbyPlayers').innerHTML = room.players.map(p => `
    <li class="flex items-center justify-between bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-3 ${p.connected ? '' : 'opacity-50'}">
      <span class="font-semibold">${p.userId === room.hostId ? '👑 ' : ''}${esc(p.username)}${p.userId === S.user.id ? ' <span class="text-xs text-slate-400">(tu)</span>' : ''}</span>
      <span class="text-xs text-amber-300 font-heading font-bold">ELO ${p.elo}</span></li>`).join('');
  const startBtn = $('#startBtn');
  startBtn.classList.toggle('hidden-view', !isHost);
  startBtn.disabled = room.players.length < 2;
  $('#lobbyMsg').className = 'text-sm min-h-[1.25rem] mb-3 text-slate-400';
  $('#lobbyMsg').textContent = isHost
    ? (room.players.length < 2 ? 'Invita almeno un altro giocatore per iniziare.' : 'Pronti? Avvia quando vuoi.')
    : 'In attesa che l\'host avvii la partita…';
}
$('#lobbyCode').onclick = () => { navigator.clipboard?.writeText(S.room.code); toast('Codice copiato'); };
$('#inviteBtn').onclick = () => {
  const username = $('#inviteName').value.trim(); if (!username) return;
  S.socket.emit('room:invite', { username }, r => {
    $('#lobbyMsg').className = 'text-sm min-h-[1.25rem] mb-3 ' + (r.error ? 'text-rose-400' : 'text-emerald-400');
    $('#lobbyMsg').textContent = r.error || `Invito inviato a ${username}`;
    if (!r.error) $('#inviteName').value = '';
  });
};
$('#startBtn').onclick = () => S.socket.emit('room:start', {}, r => r.error && ($('#lobbyMsg').textContent = r.error));
$('#leaveBtn').onclick = () => S.socket.emit('room:leave', {}, () => { S.room = null; loadHome(); });

// ---------- Partita ----------
let timerInt;
function startTimer(remainingMs, totalMs) {
  clearInterval(timerInt);
  const end = Date.now() + remainingMs;
  let lastSec = null;
  const tick = () => {
    const left = Math.max(0, end - Date.now());
    $('#gTimerBar').style.width = (left / totalMs * 100) + '%';
    $('#gTimerBar').style.background = left < totalMs * 0.25 ? '#ef4444' : '';
    const sec = Math.ceil(left / 1000);
    $('#gTimerText').textContent = sec;
    if (sec !== lastSec && sec <= 3 && sec > 0 && !S.game.answered) sfx.tick();
    lastSec = sec;
    if (left <= 0) clearInterval(timerInt);
  };
  tick(); timerInt = setInterval(tick, 100);
}

function renderQuestion(q) {
  S.game = { ...(S.game || {}), index: q.index, answered: false, score: S.game?.score || 0 };
  show('game');
  $('#gTopic').textContent = q.category;
  $('#gCounter').textContent = `Domanda ${q.index + 1} di ${q.total}`;
  $('#gProgress').style.width = ((q.index + 1) / q.total * 100) + '%';
  $('#gQuestion').textContent = q.text;
  $('#liveScore').textContent = S.game.score;
  $('#gFeedback').classList.add('hidden-view');
  $('#gScoreboard').classList.add('hidden-view');
  $('#gWaiting').textContent = '';
  $('#gOptions').innerHTML = q.options.map((o, i) => `
    <button data-i="${i}" class="option-btn p-4 rounded-2xl text-left flex items-center gap-3 text-slate-200 font-medium text-sm sm:text-base">
      <span class="option-letter w-8 h-8 rounded-xl flex items-center justify-center font-heading font-bold text-xs shrink-0">${LETTERS[i]}</span>
      <span>${esc(o)}</span></button>`).join('');
  document.querySelectorAll('#gOptions .option-btn').forEach(b => b.onclick = () => {
    if (S.game.answered) return;
    S.game.answered = true; S.game.chosen = Number(b.dataset.i);
    document.querySelectorAll('#gOptions .option-btn').forEach(x => { x.disabled = true; });
    b.classList.add('selected');
    S.socket.emit('answer', { index: S.game.chosen });
    $('#gWaiting').textContent = 'Risposta inviata! In attesa degli altri…';
    sfx.click();
  });
  startTimer(q.remainingMs, q.timeLimitMs);
}

function renderReveal(r) {
  clearInterval(timerInt);
  const btns = document.querySelectorAll('#gOptions .option-btn');
  btns.forEach(b => { b.disabled = true; b.classList.remove('selected'); });
  btns[r.correctIndex]?.classList.add('correct');
  const mine = r.round.find(x => x.userId === S.user.id);
  if (mine && mine.chosenIndex !== null && !mine.isCorrect) btns[mine.chosenIndex]?.classList.add('incorrect');
  const ok = mine?.isCorrect;
  const timedOut = mine && mine.chosenIndex === null;
  const fb = $('#gFeedback');
  fb.className = `rounded-2xl p-4 mb-5 border text-sm leading-relaxed ${ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' : 'bg-rose-500/10 border-rose-500/30 text-rose-200'}`;
  fb.innerHTML = `<h4 class="font-heading font-bold text-base mb-1">${ok ? `Esatta! +${mine.points} punti` : timedOut ? 'Tempo scaduto!' : 'Risposta errata!'}</h4><p class="text-slate-300">${esc(r.explanation || '')}</p>`;
  ok ? sfx.correct() : sfx.wrong();
  const me = r.scoreboard.find(x => x.userId === S.user.id);
  S.game.score = me ? me.score : S.game.score;
  $('#liveScore').textContent = S.game.score;
  $('#gWaiting').textContent = r.last ? 'Calcolo risultati e ELO…' : '';
  const sb = $('#gScoreboard');
  sb.classList.remove('hidden-view');
  sb.innerHTML = '<h4 class="font-heading font-bold text-sm text-slate-400 uppercase tracking-wider mb-2">Classifica parziale</h4>' +
    r.scoreboard.map((p, i) => `<div class="flex justify-between text-sm py-1 ${p.userId === S.user.id ? 'theme-text-primary font-bold' : ''}"><span>${i + 1}. ${esc(p.username)}</span><span class="font-heading">${p.score}</span></div>`).join('');
}

// ---------- Risultati ----------
const MEDALS = ['🥇', '🥈', '🥉'];
function renderResults(data, { fromHistory = false } = {}) {
  clearInterval(timerInt);
  S.game = null;
  const { match, podium, me } = data;
  show('results');
  window.scrollTo({ top: 0 });

  // Podio arcade: ordine visivo 2° - 1° - 3°
  const top = podium.slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean);
  $('#podium').innerHTML = order.map(p => {
    const pos = Math.min(p.placement, 3);
    return `<div class="podium-col podium-${pos}-wrap">
      ${pos === 1 ? '<div class="winner-crown text-3xl">👑</div>' : ''}
      <div class="podium-avatar">${MEDALS[pos - 1]}</div>
      <div class="podium-name mb-2 ${p.userId === S.user.id ? 'text-amber-300' : 'text-white'}">${esc(p.username)}</div>
      <div class="podium-block podium-${pos}">${p.placement}</div></div>`;
  }).join('');
  $('#resMeta').textContent = `${match.topic} · ${match.nQuestions} domande · ${match.timeLimitS}s`;

  $('#resRanking').innerHTML = podium.map(p => {
    const d = p.eloAfter - p.eloBefore;
    return `<div class="flex items-center justify-between gap-3 bg-slate-900/60 border ${p.userId === S.user.id ? 'theme-border-primary' : 'border-slate-800'} rounded-xl px-4 py-3">
      <div><div class="font-semibold text-sm">${p.placement}° ${esc(p.username)}</div>
      <div class="text-xs text-slate-400">${p.score} pt · ${p.correctCount}/${p.total} corrette · ${(p.avgTimeMs / 1000).toFixed(1)}s medi</div></div>
      <div class="text-right"><div class="font-heading font-bold">${p.eloAfter}</div>
      <div class="text-xs font-bold ${d >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${d >= 0 ? '▲ +' : '▼ '}${d}</div></div></div>`;
  }).join('');

  $('#resAnswers').innerHTML = me.answers.map((a, i) => {
    const chosen = a.chosenIndex === null ? '<em class="text-slate-400">nessuna risposta (tempo scaduto)</em>' : esc(a.options[a.chosenIndex]);
    return `<div class="rounded-xl p-4 border ${a.isCorrect ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'}">
      <div class="flex justify-between gap-3 text-xs text-slate-400 mb-1"><span>Domanda ${i + 1}</span><span>⏱ ${(a.timeMs / 1000).toFixed(1)}s · ${a.points} pt</span></div>
      <div class="font-semibold text-sm mb-2">${esc(a.text)}</div>
      <div class="text-sm">${a.isCorrect ? '✅' : '❌'} Tua risposta: ${chosen}</div>
      ${a.isCorrect ? '' : `<div class="text-sm text-emerald-300">✔ Corretta: ${esc(a.options[a.correctIndex])}</div>`}</div>`;
  }).join('');

  if (!fromHistory) {
    const mine = podium.find(p => p.userId === S.user.id);
    S.user.elo = mine.eloAfter; $('#hdrElo').textContent = mine.eloAfter;
    if (mine.placement === 1) {
      sfx.finish();
      setTimeout(() => window.confetti?.({ particleCount: 140, spread: 80, origin: { y: 0.5 } }), 2400);
    }
  }
}
$('#resHome').onclick = loadHome;
$('#resLb').onclick = loadLeaderboard;

// ---------- Classifica ----------
async function loadLeaderboard() {
  const rows = await api('/leaderboard');
  $('#lbList').innerHTML = rows.map((u, i) => `
    <div class="flex items-center justify-between gap-3 bg-slate-900/60 border ${u.id === S.user.id ? 'theme-border-primary' : 'border-slate-800'} rounded-xl px-4 py-3">
      <div class="flex items-center gap-3"><span class="font-heading font-extrabold w-8 text-center">${MEDALS[i] || i + 1}</span>
      <div><div class="font-semibold text-sm">${esc(u.username)}</div><div class="text-xs text-slate-400">${u.played} partite · ${u.wins} vittorie</div></div></div>
      <span class="font-heading font-bold text-amber-300 text-lg">${u.elo}</span></div>`).join('');
  show('leaderboard');
}
$('#lbBtn').onclick = () => { if (!['game'].includes(S.view)) loadLeaderboard(); };
$('#lbBack').onclick = () => S.room ? show('lobby') : loadHome();

// ---------- Admin: gestione quiz ----------
let admTopicId = null;   // topic aperto
let admEditId = null;    // domanda in modifica (null = nuova)
let admQuestions = [];

const admMsg = (text, ok = false) => {
  $('#admMsg').className = 'text-sm min-h-[1.25rem] ' + (ok ? 'text-emerald-400' : 'text-rose-400');
  $('#admMsg').textContent = text;
};
const admCall = async (fn) => {
  try { return await fn(); } catch (e) { admMsg(e.message); return null; }
};

async function loadAdmin() {
  show('admin');
  await renderAdminTopics();
  if (admTopicId) await openAdminTopic(admTopicId);
}

async function renderAdminTopics() {
  const topics = await api('/admin/topics');
  $('#admTopics').innerHTML = topics.map(t => `
    <div class="flex items-center justify-between gap-2 bg-slate-900/60 border ${t.id === admTopicId ? 'theme-border-primary' : 'border-slate-800'} rounded-xl px-3 py-2 ${t.active ? '' : 'opacity-50'}">
      <button data-open="${t.id}" class="text-left flex-1">
        <div class="font-semibold text-sm">${esc(t.name)}${t.active ? '' : ' <span class="text-xs text-rose-400">(eliminato)</span>'}</div>
        <div class="text-xs text-slate-400">${t.activeQuestions} attive / ${t.questions} totali</div>
      </button>
      <button data-rename="${t.id}" data-name="${esc(t.name)}" class="text-xs text-slate-400 hover:text-white px-1" title="Rinomina">✎</button>
      ${t.active
        ? `<button data-deltopic="${t.id}" class="text-xs text-rose-400 hover:text-rose-300 px-1" title="Elimina (soft)">🗑</button>`
        : `<button data-restoretopic="${t.id}" class="text-xs text-emerald-400 px-1" title="Ripristina">↺</button>`}
    </div>`).join('');

  document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openAdminTopic(Number(b.dataset.open)));
  document.querySelectorAll('[data-rename]').forEach(b => b.onclick = () => admCall(async () => {
    const name = prompt('Nuovo nome del topic:', b.dataset.name);
    if (!name) return;
    await api('/admin/topics/' + b.dataset.rename, { method: 'PATCH', body: { name } });
    admMsg('Topic rinominato', true); await renderAdminTopics();
  }));
  document.querySelectorAll('[data-deltopic]').forEach(b => b.onclick = () => admCall(async () => {
    if (!confirm('Eliminare il topic? Le partite passate restano visibili, ma non sarà più giocabile.')) return;
    await api('/admin/topics/' + b.dataset.deltopic, { method: 'DELETE' });
    if (admTopicId === Number(b.dataset.deltopic)) admTopicId = null;
    admMsg('Topic eliminato', true); await loadAdmin();
  }));
  document.querySelectorAll('[data-restoretopic]').forEach(b => b.onclick = () => admCall(async () => {
    await api('/admin/topics/' + b.dataset.restoretopic, { method: 'PATCH', body: { active: true } });
    admMsg('Topic ripristinato', true); await renderAdminTopics();
  }));
}

async function openAdminTopic(id) {
  admTopicId = id;
  admEditId = null;
  $('#admForm').classList.add('hidden-view');
  const topic = (await api('/admin/topics')).find(t => t.id === id);
  $('#admQTitle').textContent = topic ? topic.name : 'Topic';
  $('#admNewQ').classList.remove('hidden-view');
  admQuestions = await api(`/admin/topics/${id}/questions`);
  renderAdminQuestions();
  await renderAdminTopics();
}

function renderAdminQuestions() {
  if (!admQuestions.length) {
    $('#admQuestions').innerHTML = '<p class="text-slate-400 text-sm">Nessuna domanda in questo topic.</p>';
    return;
  }
  $('#admQuestions').innerHTML = admQuestions.map(q => `
    <div class="bg-slate-900/60 border border-slate-800 rounded-xl p-3 ${q.active ? '' : 'opacity-50'}">
      <div class="font-semibold text-sm mb-1">${esc(q.text)}${q.active ? '' : ' <span class="text-xs text-rose-400">(eliminata)</span>'}</div>
      <div class="text-xs text-slate-400 mb-2">${q.options.map((o, i) => (i === q.correctIndex ? '✔ ' : '') + LETTERS[i] + '. ' + esc(o)).join(' · ')}</div>
      <div class="flex gap-3 text-xs">
        ${q.active ? `<button data-editq="${q.id}" class="text-slate-300 hover:text-white">Modifica</button>
        <button data-delq="${q.id}" class="text-rose-400 hover:text-rose-300">Elimina</button>`
          : `<button data-restoreq="${q.id}" class="text-emerald-400">Ripristina</button>`}
      </div>
    </div>`).join('');

  document.querySelectorAll('[data-editq]').forEach(b => b.onclick = () => openQuestionForm(Number(b.dataset.editq)));
  document.querySelectorAll('[data-delq]').forEach(b => b.onclick = () => admCall(async () => {
    if (!confirm('Eliminare la domanda? Resta nello storico delle partite passate.')) return;
    await api('/admin/questions/' + b.dataset.delq, { method: 'DELETE' });
    admMsg('Domanda eliminata', true); await openAdminTopic(admTopicId);
  }));
  document.querySelectorAll('[data-restoreq]').forEach(b => b.onclick = () => admCall(async () => {
    await api('/admin/questions/' + b.dataset.restoreq, { method: 'PATCH', body: { active: true } });
    admMsg('Domanda ripristinata', true); await openAdminTopic(admTopicId);
  }));
}

function openQuestionForm(id = null) {
  const q = id ? admQuestions.find(x => x.id === id) : null;
  admEditId = id;
  $('#qText').value = q?.text || '';
  document.querySelectorAll('.qOpt').forEach((inp, i) => inp.value = q?.options[i] || '');
  $('#qCorrect').value = q ? String(q.correctIndex) : '0';
  $('#qExpl').value = q?.explanation || '';
  $('#qError').textContent = '';
  $('#admForm').classList.remove('hidden-view');
  $('#qText').focus();
}

$('#adminBtn').onclick = () => admCall(loadAdmin);
$('#admBack').onclick = () => loadHome();
$('#admNewQ').onclick = () => openQuestionForm(null);
$('#qCancel').onclick = () => $('#admForm').classList.add('hidden-view');
$('#admAddTopic').onclick = () => admCall(async () => {
  const name = $('#admNewTopic').value.trim();
  if (!name) return;
  const t = await api('/admin/topics', { method: 'POST', body: { name } });
  $('#admNewTopic').value = '';
  admMsg('Topic creato', true);
  await openAdminTopic(t.id);
});
$('#admForm').onsubmit = async e => {
  e.preventDefault();
  if (!admTopicId) return;
  const body = {
    text: $('#qText').value.trim(),
    options: [...document.querySelectorAll('.qOpt')].map(i => i.value.trim()),
    correctIndex: Number($('#qCorrect').value),
    explanation: $('#qExpl').value.trim()
  };
  try {
    if (admEditId) await api('/admin/questions/' + admEditId, { method: 'PATCH', body });
    else await api('/admin/questions', { method: 'POST', body: { ...body, topicId: admTopicId } });
    $('#admForm').classList.add('hidden-view');
    admMsg(admEditId ? 'Domanda aggiornata' : 'Domanda creata', true);
    await openAdminTopic(admTopicId);
  } catch (err) { $('#qError').textContent = err.message; }
};

// ---------- Socket ----------
function connectSocket() {
  S.socket?.disconnect();
  const sock = S.socket = io({ auth: { token: S.token } });
  sock.on('connect_error', err => { if (err.message === 'unauthorized') logout(); });
  sock.on('room:state', room => {
    const wasPlaying = S.room?.status === 'playing';
    S.room = room;
    if (room.status === 'lobby') { renderLobby(room); show('lobby'); }
    else if (!wasPlaying && S.view !== 'game') show('game');
  });
  sock.on('game:question', q => renderQuestion(q));
  sock.on('game:answered', a => {
    if (S.game?.answered) $('#gWaiting').textContent = `Risposte: ${a.answered}/${a.total}`;
  });
  sock.on('game:reveal', r => renderReveal(r));
  sock.on('game:over', data => { S.room = null; renderResults(data); });
  sock.on('room:closed', () => { S.room = null; if (S.view !== 'results') loadHome(); });
  sock.on('invite:received', inv => {
    sfx.correct();
    toast(`<b>${esc(inv.from)}</b> ti invita a una sfida di <b>${esc(inv.topic)}</b>`, {
      actions: [{ label: 'Accetta', primary: true, onClick: () => joinRoom(inv.code) }, { label: 'Ignora', onClick() {} }], ms: 20000
    });
  });
}

// ---------- Avvio ----------
async function boot() {
  if (!S.token) { renderAuthMode(); return show('auth'); }
  try {
    connectSocket();
    await loadHome();
  } catch (e) {
    if (e.status === 401) logout(); else toast(esc(e.message));
  }
}
boot();
