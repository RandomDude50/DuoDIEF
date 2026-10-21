# QuizDuel

Quiz multiplayer in tempo reale, in stile Kahoot semplificato, con classifica ELO.

## Funzionalità

- **Account:** registrazione e login (email o username), profilo con ELO, vittorie, sconfitte e accuratezza.
- **Topic:** domande di cultura generale suddivise per categoria. Ogni partita ne estrae N a caso tra quelle attive.
- **Lobby:** crea una stanza con codice, invita utenti online, avvia la partita (2-8 giocatori).
- **Partita sincrona:** stessa domanda per tutti, timer per turno, punti per correttezza e velocità.
- **Risultati:** podio animato, resoconto delle risposte, variazione ELO.
- **Classifica globale** ordinata per ELO e storico partite.
- **Admin:** gestione di topic e domande (crea, modifica, elimina, ripristina). Le eliminazioni sono soft: lo storico delle partite resta intatto.

## Requisiti

- Node.js 18 o superiore
- Strumenti di build per `better-sqlite3` (Python 3 e compilatore C/C++)

## Avvio

```bash
npm install
JWT_SECRET=una-stringa-segreta npm start
```

Apri `http://localhost:3000`. Un modello di configurazione è in `.env.example`.

Stato del servizio: `GET /health` risponde `{"status":"ok"}` se il database è raggiungibile.

Variabili d'ambiente opzionali:

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` | `3000` | Porta del server |
| `NODE_ENV` | `development` | Con `production` il server si rifiuta di partire senza `JWT_SECRET` |
| `JWT_SECRET` | segreto di sviluppo | Chiave per i token di login (obbligatoria in produzione) |
| `DB_PATH` | `quiz.db` | Percorso del file SQLite |
| `REVEAL_MS` | `4500` | Durata in ms della schermata con la risposta corretta |

## Amministrazione

Un account diventa admin da terminale, con il suo username:

```bash
node server/make-admin.js alice            # promuove ad admin
node server/make-admin.js alice --revoke   # riporta a utente normale
```

Un admin vede il pulsante **⚙ Admin** nell'header e può:

- creare, rinominare, eliminare e ripristinare i topic;
- creare, modificare, eliminare e ripristinare le domande (4 opzioni, una corretta, spiegazione facoltativa).

**Eliminare** non cancella mai i dati: imposta `active = 0`. Una domanda eliminata non viene più sorteggiata, un topic eliminato non compare più tra quelli giocabili, ma le partite passate restano consultabili. Le modifiche valgono solo per le partite iniziate dopo il salvataggio.

## Test

```bash
npm run test:e2e
```

Avvia il server e verifica una partita completa a 2 giocatori, i permessi admin e il soft delete.

## Struttura del progetto

```
quizduel/
├── server/
│   ├── index.js       # Entry point: Express + Socket.IO
│   ├── routes.js      # API REST: auth, profilo, topic, classifica, admin
│   ├── game.js        # Logica delle stanze e della partita in tempo reale
│   ├── elo.js         # Calcolo della variazione ELO
│   ├── matchData.js   # Payload dei risultati di una partita
│   ├── db.js          # Connessione SQLite, schema e migrazioni
│   ├── seed.js        # Domande iniziali (solo se il DB è vuoto)
│   └── make-admin.js  # Promuove o revoca un admin da terminale
├── public/
│   ├── index.html     # Struttura e stile dell'interfaccia
│   └── app.js         # Logica del client (viste, socket, audio, gestione quiz)
├── test/
│   └── e2e.js         # Test end-to-end
├── schema.sql         # Schema del database
├── package.json
└── package-lock.json  # Versioni esatte delle dipendenze (committalo)
```# DuoDIEF
