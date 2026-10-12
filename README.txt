CD WALL MOBILE - PWA PER IPHONE / IOS 27
========================================

Questa cartella contiene una Progressive Web App. Per installarla su iPhone deve
essere pubblicata su un sito HTTPS: non basta aprire index.html come file locale.

INSTALLAZIONE SU IPHONE
1. Pubblica tutto il contenuto della cartella su un hosting HTTPS.
2. Apri l'indirizzo con Safari su iPhone.
3. Tocca Condividi > Aggiungi alla schermata Home.
4. Attiva "Apri come app" e tocca Aggiungi.

FUNZIONI
- foto dalla fotocamera o dalla libreria Foto;
- OCR italiano/inglese eseguito nel browser tramite Tesseract.js;
- riconoscimento musicale assistito: rileva i dorsi, legge il singolo CD e
  confronta i risultati con MusicBrainz;
- barcode EAN/UPC tramite API del browser o ZXing;
- catalogo e fotografie in IndexedDB locale;
- mappa touch: ricerca titolo, evidenziazione del dorso e popup al tocco;
- duplicati, posizione, modifica, prestiti, CSV e stampa/PDF;
- backup completo .cdwall condivisibile con iCloud Drive;
- backup compatibile in entrambe le direzioni con la versione Windows.

RICONOSCIMENTO CD INTELLIGENTE
Dopo aver scelto la foto, tocca "Riconosci CD". L'app evidenzia i possibili
dorsi: toccane uno per leggerlo nelle due direzioni e confrontarlo con
MusicBrainz. Verifica sempre il risultato proposto prima di salvare.

PRIVACY
Le fotografie non vengono inviate al server dell'app. OCR e barcode lavorano sul
dispositivo. La ricerca MusicBrainz invia soltanto testo o codice a barre quando
l'utente preme il relativo pulsante. Il backup viene condiviso solo su richiesta.

NOTA OFFLINE
L'interfaccia e i dati funzionano offline dopo la prima apertura. I motori OCR e
barcode vengono memorizzati dal browser dopo il primo utilizzo; il primo avvio di
queste funzioni richiede una connessione Internet.
