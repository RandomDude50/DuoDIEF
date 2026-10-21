# Guida per lo sviluppatore

Note operative per lavorare su QuizDuel in locale e per il deploy sulla VPS.

## 1. Configurazione e segreti

### JWT_SECRET

`JWT_SECRET` è la chiave con cui il server firma i token di login. Va generata una volta, tenuta segreta sulla VPS e non cambiata senza motivo.

**Generazione** (sulla VPS, dentro la cartella del progetto):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Ottieni una stringa di 96 caratteri esadecimali. Copiala: è il valore da usare.

**Inserimento nel file `.env`:**

```bash
cp .env.example .env
nano .env
```

Compila le righe così, senza spazi attorno al `=` e senza virgolette:

```
NODE_ENV=production
JWT_SECRET=la-stringa-che-hai-generato
DB_PATH=/percorso/stabile/quiz.db
```

Proteggi il file, così lo legge solo il tuo utente:

```bash
chmod 600 .env
```

### Come Node legge il `.env`

Node non carica il `.env` da solo, e il progetto non usa `dotenv`. Lo script `start` in `package.json` è già configurato così:

```json
"start": "node --env-file-if-exists=.env server/index.js"
```

Il flag `--env-file-if-exists` richiede **Node 22.9 o successivo** (vedi `engines` in `package.json`). Lo stesso vale per `npm run admin`.

Regole di precedenza:

- Se una variabile è già esportata nell'ambiente (per esempio con `Environment=` in systemd), quella vince sul file `.env`.
- Con `NODE_ENV=production` nel `.env`, il controllo che blocca l'avvio senza `JWT_SECRET` funziona lo stesso, perché il file viene caricato prima che il server parta.

### Regole sul segreto

- **Non committare mai `.env`.** È nel `.gitignore`, ma controlla con `git status` prima di ogni commit.
- **Non cambiarlo senza motivo.** Ogni cambio disconnette tutti gli utenti, perché i token firmati con la chiave vecchia non passano più la verifica. Va bene solo se sospetti una fuga del segreto.
- **Non riusarlo tra progetti.** Ogni app ne ha uno suo.
- **Se lo perdi, non c'è recupero.** Basta generarne uno nuovo: chi era loggato dovrà accedere di nuovo.

### Altre variabili

| Variabile | Uso |
|---|---|
| `PORT` | Porta HTTP (default `3000`) |
| `NODE_ENV` | `production` attiva il controllo su `JWT_SECRET` |
| `DB_PATH` | Percorso del file SQLite (default `quiz.db` nella radice del progetto) |
| `REVEAL_MS` | Durata della schermata con la risposta corretta (default `4500`). Utile abbassarla in sviluppo |

## 2. Avvio in locale

```bash
npm install
cp .env.example .env     # poi compila JWT_SECRET
npm start
```

Il server stampa `QuizDuel in ascolto su http://localhost:3000`. Per evitare di creare il `.env` in locale puoi anche passare le variabili inline:

```bash
JWT_SECRET=dev NODE_ENV=development npm start
```

## 3. Testare il gioco in locale

- **Due account nello stesso browser non funzionano.** Il token è salvato in `localStorage`, condiviso tra le schede dello stesso profilo. Per simulare due giocatori usa una finestra in incognito, oppure un secondo profilo del browser.
- **Test automatico:** `npm run test:e2e`. Avvia un server di prova con un database temporaneo, su una porta casuale, e non usa il tuo `.env` né il tuo `quiz.db`.
- **Partite veloci:** con `REVEAL_MS=800` e il tempo per domanda al minimo (5 secondi, scelta in lobby), una partita dura meno di un minuto.

## 4. Pannello admin

Un account diventa admin da terminale. Lo username va passato dopo `--`:

```bash
npm run admin -- alice            # promuove
npm run admin -- alice --revoke   # riporta a utente normale
```

Il ruolo viene riletto dal database a ogni richiesta, quindi la revoca ha effetto subito, anche su una sessione già aperta.

In produzione lo stesso comando va eseguito sulla VPS, nella cartella del progetto, con il `.env` già configurato.

## 5. Database

### Posizione e file

- Il database è un file SQLite. Con `journal_mode = WAL` compaiono anche `quiz.db-wal` e `quiz.db-shm`: **sono parte del database**, non file da cancellare.
- Per copiare il database a caldo usa il comando di backup di SQLite, **non `cp`** mentre il server è in esecuzione:

```bash
sqlite3 quiz.db ".backup 'backup-$(date +%F).db'"
```

### Reset completo

Per ripartire da zero: ferma il server, cancella i file del database, riavvia. Il seed ricrea topic e domande di esempio.

```bash
rm -f quiz.db quiz.db-wal quiz.db-shm
npm start
```

**Attenzione:** in produzione questo cancella utenti e storico. Non farlo sulla VPS senza un backup.

### Schema e migrazioni

- Lo schema è in `schema.sql`. Viene eseguito all'avvio con `CREATE TABLE IF NOT EXISTS`.
- `CREATE TABLE IF NOT EXISTS` **non modifica una tabella già esistente**. Per aggiungere una colonna a un database esistente va usata la funzione `addColumnIfMissing` in `server/db.js`.
- Quando aggiungi una colonna, aggiungila in **entrambi** i posti: `schema.sql` (per i database nuovi) e `db.js` (per quelli esistenti).

### Regola del soft delete

- Domande e topic **non vanno mai cancellati con `DELETE` SQL**. Le risposte storiche in `match_answers` e le partite in `matches` li referenziano.
- Nel codice "eliminare" significa impostare `active = 0`. Le rotte admin lo fanno già così.

### Seed

- `server/seed.js` popola topic e domande **solo se la tabella `topics` è vuota**. Modificarlo non ha effetto su un database già popolato.
- Per aggiungere domande in un database esistente usa il pannello admin.

## 6. Dove si cambia cosa

| Cosa | Dove |
|---|---|
| Punti per risposta e bonus velocità | `handleAnswer` in `server/game.js` |
| Numero massimo/minimo di giocatori | `MIN_PLAYERS` e `MAX_PLAYERS` in `server/game.js` |
| Tolleranza di rete sul timer | `room.timeLimit * 1000 + 400` in `nextQuestion` (`server/game.js`) |
| Sensibilità ELO | `K` e `KP` in `server/elo.js` |
| Limiti di domande e tempo in lobby | `clamp(...)` in `room:create` (`server/game.js`) |
| Validazione domande (4 opzioni, indice 0-3) | `checkQuestion` in `server/routes.js` |
| Aspetto grafico | `public/index.html` (stile nel `<style>`, colori tramite variabili CSS) |

## 7. Limiti da ricordare

- **Una sola istanza del server.** Le stanze di gioco vivono in memoria: con due processi, i giocatori della stessa stanza potrebbero finire su istanze diverse.
- **Un riavvio interrompe le partite in corso.** I risultati già salvati restano.
- **Il frontend non ha un passo di build.** I file in `public/` vengono serviti così come sono. Tailwind e le fonti vengono caricati da internet: senza connessione la grafica è rovinata.
- **Nessun rate limiting** su login e registrazione.
- **Classifica limitata ai primi 50 utenti**, senza paginazione.

## 8. Debug rapido

- **`JWT_SECRET non impostato` in log:** il server gira con il segreto di sviluppo. Controlla che `.env` esista nella cartella di avvio, o che la variabile sia esportata.
- **`Errore: JWT_SECRET è obbligatorio in produzione`:** `NODE_ENV=production` è attivo ma manca il segreto. È il comportamento voluto.
- **`Cannot find module 'express'`:** le dipendenze non sono installate. Esegui `npm install`.
- **Errore di compilazione di `better-sqlite3`:** servono Python 3 e un compilatore C/C++ (`build-essential` su Debian/Ubuntu).
- **Utente loggato ma senza accesso admin:** il ruolo è nel database. Verifica con `npm run admin -- <username>`, poi ricarica la pagina.
- **Dopo un riavvio la stanza non c'è più:** è normale, le stanze sono in memoria (vedi sezione 7).
