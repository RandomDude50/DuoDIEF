// Controlli di avvio: in produzione il segreto dei token è obbligatorio.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('Errore: JWT_SECRET è obbligatorio in produzione. Vedi .env.example.');
  process.exit(1);
}

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const db = require('./db');
const { router } = require('./routes');
const { attach } = require('./game');

const app = express();
app.set('trust proxy', 1);          // dietro un reverse proxy (HTTPS) l'app vede l'IP e il protocollo reali
app.use(express.json());

app.get('/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'db error' });
  }
});

app.use('/api', router);
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = new Server(server);
attach(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`QuizDuel in ascolto su http://localhost:${PORT}`));

// Chiusura ordinata: chiude le connessioni e il DB, così SQLite non resta con transazioni a metà.
function shutdown(signal) {
  console.log(`${signal} ricevuto, chiusura in corso…`);
  io.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref(); // safety net
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
