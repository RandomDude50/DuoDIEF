// Test end-to-end: avvia il server, due giocatori fanno una partita completa via REST + Socket.IO.
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');
const Database = require('better-sqlite3');
const { io } = require('socket.io-client');

const PORT = 3900 + Math.floor(Math.random() * 90);
const DB_PATH = path.join(os.tmpdir(), `quizduel-test-${process.pid}.db`);
const BASE = `http://localhost:${PORT}`;

const post = (p, body, token) => fetch(BASE + '/api' + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body)
}).then(async r => ({ status: r.status, body: await r.json() }));
const get = (p, token) => fetch(BASE + '/api' + p, { headers: { Authorization: 'Bearer ' + token } }).then(async r => ({ status: r.status, body: await r.json() }));

async function main() {
  const server = spawn('node', [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT, DB_PATH, REVEAL_MS: '200', JWT_SECRET: 'test' }, stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise(res => server.stdout.on('data', d => String(d).includes('in ascolto') && res()));
  const sockets = [];
  try {
    // Auth
    const a = (await post('/auth/signup', { username: 'alice', email: 'alice@test.it', password: 'secret1' })).body;
    const b = (await post('/auth/signup', { username: 'bob', email: 'bob@test.it', password: 'secret2' })).body;
    assert(a.token && b.token, 'signup');
    assert.strictEqual((await post('/auth/login', { identifier: 'alice', password: 'wrong' })).status, 401, 'login errato rifiutato');
    assert.strictEqual((await post('/auth/signup', { username: 'alice', email: 'x@y.it', password: 'secret1' })).status, 409, 'duplicato rifiutato');
    console.log('✓ auth');

    const topics = (await get('/topics', a.token)).body;
    assert(topics.length >= 4, 'topics seed');

    // Socket
    const connect = token => new Promise((res, rej) => {
      const s = io(BASE, { auth: { token } }); sockets.push(s);
      s.on('connect', () => res(s)); s.on('connect_error', rej);
    });
    const sa = await connect(a.token), sb = await connect(b.token);
    await assert.rejects(connect('bad-token'), /unauthorized/, 'socket senza token valido rifiutato');

    const emit = (s, ev, p) => new Promise(r => s.emit(ev, p, r));
    const created = await emit(sa, 'room:create', { topicId: topics[0].id, nQuestions: 5, timeLimit: 10 });
    assert(created.code, 'room:create');
    assert.strictEqual((await emit(sb, 'room:join', { code: 'ZZZZZ' })).error, 'Stanza non trovata');
    assert.strictEqual((await emit(sa, 'room:start', {})).error, 'Servono almeno 2 giocatori');

    const invited = new Promise(r => sb.once('invite:received', r));
    assert((await emit(sa, 'room:invite', { username: 'bob' })).ok, 'invito');
    assert.strictEqual((await invited).code, created.code);
    assert((await emit(sb, 'room:join', { code: created.code })).ok, 'join');
    console.log('✓ lobby + invito');

    // Partita: alice risponde sempre giusto, bob sempre sbagliato
    const ro = new Database(DB_PATH, { readonly: true });
    const correctOf = text => ro.prepare('SELECT correct_index FROM questions WHERE text = ?').get(text).correct_index;
    let questions = 0;
    sa.on('game:question', q => {
      assert(!('correctIndex' in q), 'la domanda non deve rivelare la risposta');
      questions++; sa.emit('answer', { index: correctOf(q.text) });
    });
    sb.on('game:question', q => sb.emit('answer', { index: (correctOf(q.text) + 1) % 4 }));
    const over = [sa, sb].map(s => new Promise(r => s.once('game:over', r)));
    assert((await emit(sa, 'room:start', {})).ok, 'start');
    const [ra, rb] = await Promise.all(over);
    ro.close();

    assert.strictEqual(questions, 5, '5 domande giocate');
    const pa = ra.podium.find(p => p.username === 'alice'), pb = ra.podium.find(p => p.username === 'bob');
    assert.strictEqual(pa.placement, 1); assert.strictEqual(pb.placement, 2);
    assert.strictEqual(pa.correctCount, 5); assert.strictEqual(pb.correctCount, 0);
    assert(pa.eloAfter > 1000 && pb.eloAfter < 1000, `ELO: ${pa.eloAfter}/${pb.eloAfter}`);
    assert.strictEqual(ra.me.answers.length, 5); assert.strictEqual(rb.me.answers.length, 5);
    assert(ra.me.answers.every(x => x.isCorrect) && rb.me.answers.every(x => !x.isCorrect));
    console.log(`✓ partita completa (alice ${pa.score}pt ELO ${pa.eloBefore}→${pa.eloAfter}, bob ${pb.score}pt ELO ${pb.eloBefore}→${pb.eloAfter})`);

    // Persistenza e API
    const me = (await get('/me', a.token)).body;
    assert.strictEqual(me.user.elo, pa.eloAfter); assert.strictEqual(me.stats.played, 1); assert.strictEqual(me.stats.wins, 1);
    assert.strictEqual(me.history.length, 1);
    const lb = (await get('/leaderboard', a.token)).body;
    assert.strictEqual(lb[0].username, 'alice');
    const detail = await get('/matches/' + me.history[0].matchId, b.token);
    assert.strictEqual(detail.body.me.userId, b.user.id);
    console.log('✓ persistenza, profilo, classifica, dettaglio partita');

    // Admin: permessi, CRUD e soft delete
    const adminPatch = (p, body, token) => fetch(BASE + '/api' + p, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body)
    }).then(async r => ({ status: r.status, body: await r.json() }));
    const adminDel = (p, token) => fetch(BASE + '/api' + p, {
      method: 'DELETE', headers: { Authorization: 'Bearer ' + token }
    }).then(async r => ({ status: r.status, body: await r.json() }));

    assert.strictEqual((await get('/admin/topics', b.token)).status, 403, 'non admin bloccato');
    // Promozione come da make-admin.js (qui direttamente sul DB, il server legge il ruolo a ogni richiesta)
    const w = new Database(DB_PATH);
    w.prepare("UPDATE users SET role = 'admin' WHERE username = 'alice'").run();
    w.close();
    assert.strictEqual((await get('/admin/topics', a.token)).status, 200, 'admin ammesso');

    const t = (await post('/admin/topics', { name: 'Test Soft' }, a.token)).body;
    assert(t.id, 'crea topic');
    assert.strictEqual((await post('/admin/topics', { name: 'Test Soft' }, a.token)).status, 409, 'topic duplicato');
    assert.strictEqual((await post('/admin/questions', { topicId: t.id, text: 'x', options: ['a', 'b', 'c'], correctIndex: 0 }, a.token)).status, 400, '3 opzioni rifiutate');
    const qTexts = ['Domanda uno?', 'Domanda due?', 'Domanda tre?'];
    const qIds = [];
    for (const text of qTexts) {
      const r = await post('/admin/questions', { topicId: t.id, text, options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: 'ok' }, a.token);
      assert.strictEqual(r.status, 201); qIds.push(r.body.id);
    }
    assert.strictEqual((await adminDel('/admin/questions/' + qIds[1], a.token)).status, 200, 'soft delete domanda');
    const soft = (await get('/admin/topics/' + t.id + '/questions', a.token)).body;
    assert.strictEqual(soft.find(q => q.id === qIds[1]).active, 0, 'domanda disattivata ma presente');
    assert.strictEqual((await get('/topics', a.token)).body.find(x => x.id === t.id).questions, 2, 'conteggio solo attive');

    // Il sorteggio non deve mai pescare la domanda disattivata
    const sx = connect(a.token), sy = connect(b.token);
    const [xa, xb] = await Promise.all([sx, sy]);
    sockets.push(xa, xb);
    const seen = [];
    xa.on('game:question', q => { seen.push(q.text); xa.emit('answer', { index: 0 }); });
    xb.on('game:question', q => xb.emit('answer', { index: 0 }));
    const overSoft = [xa, xb].map(s => new Promise(r => s.once('game:over', r)));
    await emit(xa, 'room:leave', {});
    const cr = await emit(xa, 'room:create', { topicId: t.id, nQuestions: 3, timeLimit: 5 });
    assert(cr.code, 'room su topic con 2 domande attive');
    assert((await emit(xb, 'room:join', { code: cr.code })).ok);
    assert((await emit(xa, 'room:start', {})).ok);
    await Promise.all(overSoft);
    assert.strictEqual(seen.length, 2, 'giocate solo le domande attive');
    assert(!seen.includes(qTexts[1]), 'domanda eliminata non sorteggiata');
    console.log('✓ soft delete domanda: esclusa dal sorteggio');

    // Soft delete topic: sparisce dalla lista di gioco e non è più creabile, ma lo storico resta
    assert.strictEqual((await adminDel('/admin/topics/' + t.id, a.token)).status, 200, 'soft delete topic');
    assert(!(await get('/topics', a.token)).body.some(x => x.id === t.id), 'topic nascosto ai giocatori');
    const rejected = await emit(xa, 'room:create', { topicId: t.id, nQuestions: 3, timeLimit: 5 });
    assert.strictEqual(rejected.error, 'Topic non valido', 'topic eliminato non giocabile');
    const hist = (await get('/me', b.token)).body.history;
    assert(hist.length >= 2, 'storico ancora leggibile');
    assert((await get('/matches/' + hist[0].matchId, b.token)).status, 200);
    console.log('✓ soft delete topic: nascosto ai giocatori, storico intatto');

    // Ripristino
    assert.strictEqual((await adminPatch('/admin/topics/' + t.id, { active: true }, a.token)).status, 200, 'ripristino topic');
    assert(((await get('/topics', a.token)).body).some(x => x.id === t.id), 'topic di nuovo visibile');
    console.log('✓ ripristino topic');

    console.log('\nTUTTI I TEST SUPERATI');
  } finally {
    sockets.forEach(s => s.close());
    server.kill();
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) fs.rmSync(f, { force: true });
  }
}
main().then(() => process.exit(0), e => { console.error('\nTEST FALLITO:', e.message || e); process.exit(1); });
