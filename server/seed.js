// Pool di domande predefinite. Viene popolato solo se la tabella topics è vuota.
// Formato: [testo, [4 opzioni], indice_corretta, spiegazione]
const DATA = {
  'Storia': [
    ['In quale anno è caduto il Muro di Berlino?', ['1989', '1991', '1975', '1981'], 0, 'Il Muro cadde il 9 novembre 1989, simbolo della fine della Guerra Fredda.'],
    ['In quale anno l\'uomo è sbarcato sulla Luna per la prima volta?', ['1965', '1969', '1972', '1961'], 1, 'Il 20 luglio 1969 Armstrong e Aldrin (Apollo 11) camminarono sulla Luna.'],
    ['Chi fu il primo imperatore di Roma?', ['Giulio Cesare', 'Augusto', 'Nerone', 'Traiano'], 1, 'Ottaviano, con il titolo di Augusto, divenne il primo imperatore nel 27 a.C.'],
    ['In quale anno Cristoforo Colombo raggiunse le Americhe?', ['1453', '1492', '1520', '1498'], 1, 'Colombo sbarcò nei Caraibi il 12 ottobre 1492.'],
    ['In quale anno scoppiò la Rivoluzione francese?', ['1776', '1789', '1799', '1815'], 1, 'La presa della Bastiglia, 14 luglio 1789, è l\'evento simbolo.'],
    ['In quale anno fu proclamato il Regno d\'Italia?', ['1848', '1861', '1870', '1915'], 1, 'Il Regno d\'Italia fu proclamato il 17 marzo 1861.'],
    ['In quale anno terminò la Seconda guerra mondiale in Europa?', ['1943', '1944', '1945', '1946'], 2, 'La Germania si arrese nel maggio 1945.'],
    ['Chi guidò la Spedizione dei Mille?', ['Cavour', 'Mazzini', 'Giuseppe Garibaldi', 'Vittorio Emanuele II'], 2, 'Garibaldi partì da Quarto nel 1860 con circa mille volontari.'],
    ['In quale battaglia fu sconfitto definitivamente Napoleone nel 1815?', ['Austerlitz', 'Waterloo', 'Lipsia', 'Borodino'], 1, 'A Waterloo, in Belgio, il 18 giugno 1815.'],
    ['Quale civiltà costruì Machu Picchu?', ['Maya', 'Aztechi', 'Inca', 'Olmechi'], 2, 'Machu Picchu fu costruita dagli Inca nel XV secolo.']
  ],
  'Geografia': [
    ['Qual è la capitale dell\'Australia?', ['Sydney', 'Melbourne', 'Canberra', 'Brisbane'], 2, 'Canberra fu scelta come capitale di compromesso tra Sydney e Melbourne.'],
    ['Qual è il fiume più lungo d\'Italia?', ['Po', 'Tevere', 'Adige', 'Arno'], 0, 'Il Po misura circa 652 km.'],
    ['Qual è il più grande deserto caldo del mondo?', ['Gobi', 'Sahara', 'Kalahari', 'Atacama'], 1, 'Il Sahara copre circa 9 milioni di km² in Africa.'],
    ['Qual è la montagna più alta del mondo sul livello del mare?', ['K2', 'Kilimangiaro', 'Everest', 'Monte Bianco'], 2, 'L\'Everest raggiunge circa 8.849 m.'],
    ['Qual è la capitale del Canada?', ['Toronto', 'Vancouver', 'Ottawa', 'Montréal'], 2, 'Ottawa è la capitale, non Toronto.'],
    ['Qual è l\'oceano più grande?', ['Atlantico', 'Indiano', 'Artico', 'Pacifico'], 3, 'Il Pacifico copre circa un terzo della superficie terrestre.'],
    ['Quale stretto separa la Sicilia dalla Calabria?', ['Stretto di Messina', 'Stretto di Bonifacio', 'Stretto di Gibilterra', 'Canale d\'Otranto'], 0, 'Lo Stretto di Messina è largo circa 3 km nel punto minimo.'],
    ['Qual è la capitale del Brasile?', ['Rio de Janeiro', 'San Paolo', 'Brasilia', 'Salvador'], 2, 'Brasilia è la capitale dal 1960.'],
    ['Qual è lo Stato più piccolo del mondo?', ['Monaco', 'Città del Vaticano', 'San Marino', 'Liechtenstein'], 1, 'Il Vaticano misura circa 0,44 km².'],
    ['Qual è il lago più grande d\'Italia?', ['Lago Maggiore', 'Lago di Garda', 'Lago di Como', 'Lago Trasimeno'], 1, 'Il Garda ha una superficie di circa 370 km².']
  ],
  'Scienza': [
    ['Quale elemento chimico ha simbolo "O"?', ['Oro', 'Osmio', 'Ossigeno', 'Oganesson'], 2, 'O è il simbolo dell\'ossigeno.'],
    ['Qual è il simbolo chimico dell\'oro?', ['Or', 'Ag', 'Au', 'Fe'], 2, 'Au deriva dal latino Aurum.'],
    ['Qual è il pianeta più grande del Sistema Solare?', ['Saturno', 'Giove', 'Nettuno', 'Urano'], 1, 'Giove è un gigante gassoso.'],
    ['Qual è la formula chimica dell\'acqua?', ['HO2', 'H2O', 'H2O2', 'OH'], 1, 'Due atomi di idrogeno e uno di ossigeno.'],
    ['Qual è circa la velocità della luce nel vuoto?', ['30.000 km/s', '150.000 km/s', '300.000 km/s', '1.000.000 km/s'], 2, 'Circa 299.792 km/s.'],
    ['Quale gas assorbono le piante durante la fotosintesi?', ['Ossigeno', 'Azoto', 'Anidride carbonica', 'Elio'], 2, 'Assorbono CO2 e rilasciano ossigeno.'],
    ['Quante ossa ha un corpo umano adulto?', ['186', '206', '226', '256'], 1, 'Un adulto ha 206 ossa.'],
    ['Chi formulò la teoria della relatività?', ['Newton', 'Einstein', 'Bohr', 'Galileo'], 1, 'Albert Einstein, relatività ristretta (1905) e generale (1915).'],
    ['Quale pianeta è chiamato "il pianeta rosso"?', ['Venere', 'Marte', 'Mercurio', 'Giove'], 1, 'Il colore deriva dagli ossidi di ferro sulla superficie.'],
    ['Qual è l\'unità di misura della forza nel Sistema Internazionale?', ['Joule', 'Watt', 'Newton', 'Pascal'], 2, 'Il Newton (N).']
  ],
  'Arte e Letteratura': [
    ['In quale museo è conservata la Gioconda?', ['Prado', 'Louvre', 'Uffizi', 'British Museum'], 1, 'Il Louvre di Parigi.'],
    ['Chi scrisse "I promessi sposi"?', ['Leopardi', 'Foscolo', 'Alessandro Manzoni', 'Boccaccio'], 2, 'Manzoni, edizione definitiva nel 1840.'],
    ['Chi è l\'autore della "Divina Commedia"?', ['Petrarca', 'Dante Alighieri', 'Boccaccio', 'Ariosto'], 1, 'Dante Alighieri, scritta nel XIV secolo.'],
    ['Chi affrescò la volta della Cappella Sistina?', ['Raffaello', 'Michelangelo', 'Leonardo', 'Botticelli'], 1, 'Michelangelo, tra il 1508 e il 1512.'],
    ['Chi dipinse "La nascita di Venere"?', ['Botticelli', 'Tiziano', 'Caravaggio', 'Giotto'], 0, 'Sandro Botticelli, circa 1485.'],
    ['Chi scrisse "Il Principe"?', ['Guicciardini', 'Machiavelli', 'Petrarca', 'Ariosto'], 1, 'Niccolò Machiavelli, 1513.'],
    ['Chi dipinse "Guernica"?', ['Dalí', 'Picasso', 'Miró', 'Matisse'], 1, 'Pablo Picasso, 1937.'],
    ['Chi è l\'autore de "L\'infinito"?', ['Foscolo', 'Giacomo Leopardi', 'Pascoli', 'Ungaretti'], 1, 'Giacomo Leopardi, 1819.'],
    ['Chi scrisse il "Decameron"?', ['Giovanni Boccaccio', 'Petrarca', 'Dante', 'Pirandello'], 0, 'Boccaccio, intorno al 1350.'],
    ['Chi dipinse "La notte stellata"?', ['Monet', 'Vincent van Gogh', 'Cézanne', 'Munch'], 1, 'Van Gogh, 1889.']
  ]
};

module.exports = function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM topics').get().c;
  if (count > 0) return;
  const insTopic = db.prepare('INSERT INTO topics (name) VALUES (?)');
  const insQ = db.prepare('INSERT INTO questions (topic_id, text, options, correct_index, explanation) VALUES (?,?,?,?,?)');
  db.transaction(() => {
    for (const [topic, qs] of Object.entries(DATA)) {
      const topicId = insTopic.run(topic).lastInsertRowid;
      for (const [text, options, correct, expl] of qs) {
        insQ.run(topicId, text, JSON.stringify(options), correct, expl);
      }
    }
  })();
};
