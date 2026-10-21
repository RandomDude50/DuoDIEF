// Promuove (o revoca) un account admin da terminale.
// Uso: node server/make-admin.js <username>            -> promuove
//      node server/make-admin.js <username> --revoke   -> riporta a utente normale
const db = require('./db');

const [username, flag] = process.argv.slice(2);
if (!username) {
  console.error('Uso: node server/make-admin.js <username> [--revoke]');
  process.exit(1);
}

const role = flag === '--revoke' ? 'user' : 'admin';
const res = db.prepare('UPDATE users SET role = ? WHERE username = ? COLLATE NOCASE').run(role, username);
if (res.changes === 0) {
  console.error(`Utente "${username}" non trovato.`);
  process.exit(1);
}
console.log(`${username} è ora ${role}.`);
