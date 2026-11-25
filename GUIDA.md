# Finanze: guida per iniziare

Versione della guida: 1.2. Vale per l'app 1.2 e per lo script `Code.gs` 1.1.

Questa guida è scritta per essere seguita da una persona oppure da un assistente AI che aiuta una persona. Ogni passaggio dice cosa fare, cosa si deve vedere alla fine e cosa fare se non succede. I nomi dei pulsanti sono scritti come compaiono sullo schermo, in italiano e, tra parentesi, in inglese, perché Google può mostrare l'una o l'altra lingua.

## In breve

Finanze è un'app per tenere sotto controllo i propri soldi in due modi:

- **Movimenti:** entrate e uscite di tutti i giorni, con categoria, sottocategoria, conto, valuta e nota, come in Money Manager. Con statistiche per mese, anno e categoria.
- **Patrimonio e investimenti:** titoli (ETF e azioni) con quote e guadagni calcolati dagli acquisti, depositi vincolati con interessi netti, fondo pensione anno per anno, liquidità, ribilanciamento verso gli obiettivi e fondo di emergenza. I prezzi dei titoli possono aggiornarsi da soli.

È fatta di tre pezzi:

1. **L'app**: un sito web che si installa sul telefono e sul computer. È uguale per tutti e non contiene nessun dato personale.
2. **Lo script Google** (`Code.gs`): un piccolo programma che ognuno mette nel **proprio** account Google. Fa da ponte tra l'app e il proprio Google Drive e prende i prezzi da Google Finance. È protetto da una **chiave segreta** scelta da te.
3. **I dati**: un file `dati.json` nella cartella **Finanze** del **tuo** Google Drive, più un foglio Google di riepilogo che si aggiorna da solo.

Chi gestisce l'app non vede i tuoi dati. I tuoi dati stanno solo sul tuo Drive.

L'app fa calcoli indicativi per aiutarti a capire dove sono i tuoi soldi. Non è una consulenza finanziaria e non tiene conto di commissioni, tasse sulle vendite e arrotondamenti delle quote.

## Cosa contiene il kit

- `GUIDA.md`: questa guida (la stessa che si legge nell'app, in Impostazioni, "Guida").
- `Code.gs`: lo script da copiare nel tuo account Google.
- `Versioni.txt`: lo storico delle versioni.
- `dati-vuoti.json`: un file di dati vuoto. Serve solo in casi particolari (vedi "Problemi comuni"); di solito non va usato.
- `app/`: tutti i file dell'app. Servono solo a chi vuole ospitare l'app per conto suo (vedi "Ospitare l'app per conto tuo"). Chi usa l'app già pubblicata non deve toccarli.

## Cosa ti serve

- Un account Google (Gmail va benissimo).
- Un computer con un browser, per i passi 1 e 2. Il telefono basta dal passo 3 in poi.
- L'indirizzo dell'app: te lo dà chi ti ha mandato il kit (per esempio `https://nome.github.io/finanze/`). Se non te l'ha dato, puoi pubblicarla tu: vedi "Ospitare l'app per conto tuo".
- Circa 15 minuti.

## Passo 1: crea lo script nel tuo account Google

1. Sul computer apri `https://script.google.com` ed entra con il tuo account Google.
2. Tocca **Nuovo progetto** (New project).
3. In alto a sinistra tocca **Progetto senza titolo** (Untitled project) e chiamalo `Finanze`.
4. Nel file aperto (`Codice.gs` o `Code.gs`) seleziona tutto il testo e cancellalo.
5. Apri il file `Code.gs` del kit con un editor di testo, copia **tutto** il contenuto e incollalo al posto di quello cancellato.
6. Trova la riga `const CHIAVE = 'SCRIVI-QUI-LA-TUA-CHIAVE';` e sostituisci `SCRIVI-QUI-LA-TUA-CHIAVE` con una chiave segreta inventata da te.
   - Regole per la chiave: almeno 8 caratteri, meglio 20 o più; solo lettere, numeri e trattini; niente spazi, niente apostrofi.
   - Esempio di forma corretta (non usare questo): `const CHIAVE = 'lampada-blu-quarantadue-sentieri';`
   - Se usi anche altre app con uno script simile (per esempio Spese di casa), usa una chiave diversa.
   - Scrivi la chiave anche da qualche parte al sicuro: servirà al passo 3.
7. Salva: icona del dischetto, oppure Cmd+S su Mac, Ctrl+S su Windows.
8. Nella barra in alto, nel menu a tendina delle funzioni, scegli `prova` e tocca **Esegui** (Run).
9. Google chiede l'autorizzazione. È normale: lo script deve poter creare la cartella e i file sul tuo Drive, creare il foglio di riepilogo e, se lo vorrai, aggiornare i prezzi ogni sera.
   - Tocca **Esamina autorizzazioni** (Review permissions) e scegli il tuo account.
   - Se compare "Google non ha verificato questa app" (Google hasn't verified this app): tocca **Avanzate** (Advanced), poi **Vai a Finanze (non sicura)** (Go to Finanze (unsafe)). Lo script è tuo e gira solo nel tuo account.
   - Tocca **Consenti** (Allow).
10. In basso compare il "Log di esecuzione" (Execution log).

**Risultato atteso:** nel log c'è una riga che inizia con `Tutto pronto.` e sul tuo Google Drive c'è una cartella chiamata **Finanze** con dentro il foglio **Finanze (riepilogo)**.

**Se non succede:** se il log mostra un errore rosso, controlla di aver incollato tutto il file (deve iniziare con `/**` e finire con `}`) e riprova dal punto 7.

## Passo 2: pubblica lo script come applicazione web

1. In alto a destra tocca **Esegui il deployment** (Deploy), poi **Nuovo deployment** (New deployment).
2. Accanto a "Seleziona tipo" (Select type) tocca l'ingranaggio e scegli **Applicazione web** (Web app).
3. Compila così:
   - Descrizione (Description): `Finanze`
   - Esegui come (Execute as): **Me** (il tuo indirizzo email)
   - Chi ha accesso (Who has access): **Chiunque** (Anyone)
4. Tocca **Esegui il deployment** (Deploy). Se chiede di nuovo l'autorizzazione, ripeti il punto 9 del passo 1.
5. Compare la finestra con l'**URL** sotto "Applicazione web" (Web app). Tocca **Copia** (Copy) e conservalo: è l'**indirizzo dello script**.
   - L'indirizzo giusto inizia con `https://script.google.com/macros/s/` e finisce con `/exec`.
   - Non usare l'indirizzo sotto "Raccolta" (Library), se compare: è un'altra cosa.

**Perché "Chiunque" e non "Solo io":** l'app deve poter raggiungere lo script senza un login Google. Con "Solo io" lo script risponde con la pagina di accesso di Google e l'app non riesce a collegarsi. I dati restano protetti dalla chiave: senza la chiave giusta lo script non risponde con nessun dato.

**Controllo:** apri una finestra privata del browser, incolla l'indirizzo dello script e aprilo. Deve comparire una riga come `{"ok":true,"messaggio":"Il ponte Finanze è attivo."}`. Se invece compare una pagina di login Google, in "Chi ha accesso" non è stato scelto "Chiunque": rifai il passo 2 creando un nuovo deployment.

**Se durante il deployment compare "Impossibile aprire il file in questo momento"** (Sorry, unable to open the file at this time): succede quasi sempre quando nel browser sei collegato con più account Google insieme. Apri una finestra privata, entra in `https://script.google.com` solo con l'account che possiede lo script e rifai il passo 2. Prima controlla in **Esegui il deployment**, **Gestisci deployment** (Manage deployments): a volte il deployment è stato creato lo stesso e l'indirizzo `/exec` è già lì.

## Passo 3: collega l'app e scegli come partire

1. Sul telefono o sul computer apri l'indirizzo dell'app.
2. Compare la schermata **Collega Google Drive**.
   - In **Indirizzo dello script** incolla l'URL che finisce con `/exec`.
   - In **Chiave segreta** scrivi la chiave del passo 1, identica (maiuscole e minuscole contano).
   - Tocca **Collega**.
3. La prima volta compare **Collegato! Ora i dati**. Scegli una delle due strade:
   - **Inizia da zero**: crea dati vuoti con categorie già pronte (Cibo, Casa, Trasporti e altre, modificabili). È la scelta giusta per quasi tutti.
   - **Carica un dati.json**: solo se hai già un file `dati.json` di Finanze, per esempio un backup o un file preparato da qualcuno per te.

**Risultato atteso:** si apre la pagina **Movimenti**, in alto a destra compare "Salvato", e sul tuo Google Drive, nella cartella **Finanze**, compare il file `dati.json`. Il foglio **Finanze (riepilogo)** si riempie dopo qualche secondo.

**Se usavi Money Manager:** dopo "Inizia da zero" vai in **Impostazioni**, **Importa da Money Manager**, e scegli il file Excel esportato da Money Manager. L'app aggiunge tutti i movimenti con le loro categorie, sottocategorie, conti e valute. Si può ripetere più avanti con un export nuovo: aggiunge solo i movimenti che mancano.

**Su un secondo dispositivo** (per esempio il computer dopo il telefono): apri l'app, inserisci lo stesso indirizzo dello script e la stessa chiave, tocca **Collega**. I dati compaiono da soli. Non scegliere "Inizia da zero" su un Drive che ha già i dati: l'app non lo propone, perché trova già `dati.json`.

## Passo 4: installa l'app

L'app funziona anche nel browser, ma installata si apre come un'app normale, a schermo intero e anche senza rete.

- **iPhone e iPad:** apri l'indirizzo dell'app con **Safari**, tocca **Condividi** (il quadrato con la freccia), poi **Aggiungi alla schermata Home** (Add to Home Screen).
- **Android:** apri l'indirizzo con **Chrome**. Vai nell'app in **Impostazioni** e tocca **Installa l'app su questo dispositivo**. Se il pulsante non c'è, usa il menu ⋮ di Chrome, poi **Aggiungi a schermata Home** (Add to Home screen) e **Installa** (Install).
- **Mac:** con **Safari** apri l'indirizzo, poi menu **File**, **Aggiungi al Dock** (Add to Dock).
- **Windows o Chrome sul computer:** apri l'indirizzo con Chrome o Edge e tocca l'icona di installazione nella barra dell'indirizzo.

**Scorciatoie su Android:** tieni premuta l'icona dell'app installata: compaiono **Nuova uscita**, **Nuova entrata**, **Statistiche** e **Patrimonio**. Tenendo premuta una scorciatoia e trascinandola puoi metterla nella schermata Home come icona a sé: per esempio un tasto che apre subito il modulo di una nuova uscita. Un widget vero, con i numeri sulla schermata Home, non si può fare con un'app web come questa: le scorciatoie sono la cosa più vicina. Su iPhone le scorciatoie non ci sono.

## Come è fatta l'app

In basso ci sono quattro sezioni e, al centro, il pulsante **+** per aggiungere un movimento.

- **Movimenti** (la prima pagina): in alto il riquadro del mese con entrate, uscite, saldo e le barre degli ultimi sei mesi. Le frecce cambiano mese; toccando una barra vai a quel mese. Sotto ci sono la ricerca, i filtri per tipo e per conto e l'elenco giorno per giorno. Tocca un movimento per modificarlo, duplicarlo o eliminarlo.
- **Statistiche:** mese, anno o tutto il periodo; grafico entrate e uscite; ciambella e classifica delle categorie. Tocca una categoria per vedere le sue sottocategorie; tocca una sottocategoria per vederla **mese per mese** (per esempio quanto spendi in caffè ogni mese), con la media mensile e il riepilogo anno per anno.
- **Patrimonio:** il valore di tutto (depositi, titoli, fondo pensione, liquidità) con il grafico nel tempo. Scorri il dito sul grafico per leggere il valore di un giorno. Sotto, la divisione del patrimonio, il fondo di emergenza e il ribilanciamento.
- **Investimenti:** i titoli con quote, valore e guadagno; depositi, fondo pensione e liquidità; gli strumenti Ribilanciamento e Fondo di emergenza.
- **L'occhio** in alto nasconde tutti gli importi, per esempio quando usi l'app davanti ad altre persone. Le percentuali restano visibili. Si ritocca per mostrarli di nuovo.
- **L'ingranaggio** apre le Impostazioni.

## Primi passi

- **Un movimento:** tocca **+**, scegli **Uscita** o **Entrata**, scrivi l'importo, scegli categoria, sottocategoria e conto, poi **Salva**. Valuta diversa dall'euro: scegli la valuta accanto all'importo; l'app mostra il controvalore in euro e puoi correggere il cambio.
- **Nuove categorie, sottocategorie e conti:** direttamente nel modulo del movimento con **+ Nuova**, oppure in **Impostazioni**, **Categorie e sottocategorie** e **Conti**. Rinominando una categoria o un conto si aggiornano anche tutti i movimenti. Una categoria con movimenti si toglie spostando i suoi movimenti in un'altra.
- **Valute:** in **Impostazioni**, **Valute e cambi**: quanti euro vale 1 unità di ogni valuta.
- **Titoli:** in **Investimenti**, **Aggiungi un titolo** (oppure **Impostazioni**, **Aggiungi un titolo**). Scrivi nome, ISIN, classe (Azioni, Obbligazioni e così via), valuta del prezzo e, se vuoi i prezzi automatici, il codice Google Finance (vedi sotto). Poi **Nuovo acquisto** per ogni acquisto: data, quote, prezzo medio. Quote, carico e guadagno li calcola l'app. Per una vendita scrivi le quote con il meno davanti.
- **Depositi vincolati:** in **Investimenti**, la riga dei depositi, poi **Aggiungi**: importo, tasso lordo, inizio e scadenza.
- **Fondo pensione:** in **Investimenti**, la riga del fondo: **Aggiorna posizione** (posizione e versato dall'area riservata), **Modifica anni** (dagli estratti annuali: versato, risultato, valore quota), **Rendimenti e costi** (TER e confronto con il benchmark).
- **Liquidità:** in **Patrimonio**, la riga Liquidità, **Aggiorna saldi**: i saldi dei conti e i soldi da investire.
- **Ribilanciamento:** in **Investimenti**, **Ribilanciamento**: imposta gli obiettivi per classe (devono fare 100%) e la liquidità da investire; l'app dice quanto comprare di ogni titolo. Un titolo segnato "resta com'è" non viene toccato.
- **Fondo di emergenza:** in **Investimenti**, **Fondo di emergenza**: spese mensili e mesi di copertura. L'app propone la media delle tue uscite degli ultimi 12 mesi.
- **Excel:** in **Impostazioni**, **Scarica Excel**: investimenti, movimenti e riepiloghi in un unico file.

## Prezzi automatici dei titoli

I prezzi vengono da Google Finance attraverso il tuo script. Per ogni titolo serve il suo **codice Google Finance**, nella forma `BORSA:SIGLA`.

- Esempi di borse: `BIT` Borsa Italiana, `EPA` Euronext Parigi, `AMS` Euronext Amsterdam, `ETR` Xetra, `LON` Londra, `NYSE` e `NASDAQ` per gli Stati Uniti.
- Esempi di codici: `BIT:SWDA`, `ETR:EUNL`, `NASDAQ:AAPL`.
- Puoi scrivere **più codici separati da uno spazio**, per esempio `BIT:SWDA ETR:EUNL`: lo script usa il primo che risponde. È utile perché Google Finance non copre tutte le borse per tutti i titoli.
- Il prezzo che arriva è nella valuta di quella borsa: deve coincidere con la **valuta del prezzo** scelta nel titolo. Un titolo americano (`NYSE`, `NASDAQ`) ha il prezzo in dollari: imposta la valuta **USD** e il cambio in **Valute e cambi**.

Come si aggiornano:

- **All'apertura dell'app**, una volta al giorno: l'app chiede i prezzi e li salva da sola.
- **Ogni sera verso le 19**, anche ad app chiusa: in **Impostazioni** tocca **Prezzi aggiornati ogni sera** finché compare "attivo". Il sabato e la domenica non aggiorna.
- **A mano:** in **Investimenti**, **Aggiorna prezzi**, poi **Prendi da Google Finance adesso**, oppure scrivi tu i prezzi.

Per sicurezza, un prezzo che si discosta di più del 30% dal precedente non viene salvato in automatico: di solito vuol dire un codice sbagliato o una valuta diversa. Ogni aggiornamento aggiunge un punto al grafico del Patrimonio.

## Condividere con la famiglia

Per far usare **gli stessi dati** a un'altra persona, dalle tre cose:

1. l'indirizzo dell'app;
2. l'indirizzo dello script (finisce con `/exec`);
3. la chiave.

Mandale la chiave in un messaggio separato. Con la chiave si possono leggere e modificare tutti i dati. Se due persone modificano nello stesso momento, l'app unisce le modifiche.

Per togliere l'accesso a qualcuno: cambia la chiave nello script e pubblica una nuova versione (vedi sotto), poi inserisci la nuova chiave sui tuoi dispositivi (**Impostazioni**, **Cambia collegamento**).

Per far usare l'app a qualcuno **con i suoi dati**, mandagli questo kit: segue la guida dal passo 1 con il suo account Google.

## Backup e sicurezza

- Lo script salva da solo un **backup a settimana** di `dati.json` nella cartella **Finanze/backup** e tiene quelli dell'ultimo anno.
- In **Impostazioni**, **Backup automatici**, puoi tornare a un backup. Prima di ogni ripristino lo script salva comunque una copia dei dati attuali.
- In **Impostazioni**, **Scarica dati.json**, salvi una copia sul dispositivo; con **Ripristina da un file dati.json** la ricarichi.
- La chiave non va mai scritta nell'app pubblica, in un sito o in un messaggio pubblico.

## Aggiornare lo script a una nuova versione

Quando arriva un nuovo `Code.gs`:

1. Apri `https://script.google.com`, poi il progetto **Finanze**.
2. Prima di tutto copia la tua chiave dalla riga `const CHIAVE = '...';` e tienila da parte.
3. Cancella tutto il testo di `Code.gs` e incolla quello nuovo.
4. Rimetti la tua chiave nella riga `const CHIAVE`. Salva.
5. Esegui `prova` una volta: se la nuova versione ha bisogno di permessi nuovi, Google li chiede adesso.
6. Tocca **Esegui il deployment** (Deploy), poi **Gestisci deployment** (Manage deployments), poi la **matita** (Edit).
7. In **Versione** (Version) scegli **Nuova versione** (New version) e tocca **Esegui il deployment** (Deploy).

**Importante:** non creare un "Nuovo deployment" per aggiornare. Con "Gestisci deployment" l'indirizzo `/exec` resta lo stesso e non devi ricollegare i dispositivi. Con un nuovo deployment l'indirizzo cambia.

La versione dello script è scritta nella prima riga di commento di `Code.gs`. Lo storico in `Versioni.txt` dice per ogni versione se lo script va aggiornato.

## Ospitare l'app per conto tuo (facoltativo)

Serve se vuoi un tuo indirizzo dell'app. L'app è un sito statico: basta un servizio che pubblichi la cartella `app/` così com'è.

Requisiti, validi per qualsiasi servizio:

- Si pubblica il **contenuto** della cartella `app/`: il file `index.html` deve stare nella cartella principale del sito, insieme alle cartelle `icons` e `lib`.
- Il sito deve essere in **HTTPS** e **pubblico**: niente password e niente login per i visitatori. Un sito privato impedisce anche l'installazione su Android.
- Non caricare mai `dati.json`, `dati-vuoti.json` o `Code.gs` sul sito: vanno solo su Google Drive e nello script.

Servizi possibili:

- **GitHub Pages** (gratuito, senza crediti):
  1. Crea un account su `https://github.com`.
  2. In alto a destra **+**, poi **New repository**. Nome: `finanze`. Lascia **Public** (con l'account gratuito GitHub Pages funziona solo con repository pubblici; nel codice dell'app non ci sono dati personali). Tocca **Create repository**.
  3. Tocca **uploading an existing file** e trascina nella pagina **il contenuto** della cartella `app/` (file e cartelle, non la cartella `app` stessa). Tocca **Commit changes**.
  4. Vai in **Settings**, **Pages**. In **Source** scegli **Deploy from a branch**, branch **main**, cartella **/(root)**, poi **Save**.
  5. Dopo un paio di minuti l'app è a `https://tuonome.github.io/finanze/`.
  - Per aggiornare: nel repository tocca **Add file**, **Upload files**, trascina i file nuovi (sostituiscono i vecchi) e **Commit changes**.
- **Netlify:** su `https://app.netlify.com`, **Add new project**, **Deploy manually**, trascina la cartella `app`. Il piano gratuito ha crediti mensili: se finiscono il sito resta sospeso fino al mese successivo.
- **Cloudflare Pages:** nel pannello Cloudflare, **Workers & Pages**, crea un progetto **Pages** con **Upload assets** e trascina la cartella `app`.

I dispositivi prendono la nuova versione quando riaprono l'app (a volte serve chiuderla e riaprirla due volte).

Se cambi l'indirizzo dell'app (nuovo servizio o nuovo nome), su ogni dispositivo devi reinstallarla e reinserire indirizzo dello script e chiave. I dati non si perdono: stanno su Drive.

## Problemi comuni

| Cosa vedi | Cosa fare |
|---|---|
| "L'indirizzo deve iniziare con https://script.google.com/macros/s/ e finire con /exec" | Hai incollato l'indirizzo sbagliato. Copia quello sotto "Applicazione web" (passo 2, punto 5). |
| "Chiave sbagliata" | La chiave nell'app è diversa da quella nello script. Controlla maiuscole, minuscole e spazi. |
| "Nello script manca la chiave: cambiala nella prima riga e ripubblica" | Nello script c'è ancora `SCRIVI-QUI-LA-TUA-CHIAVE`. Mettila, salva e pubblica una nuova versione (vedi "Aggiornare lo script"). |
| "Risposta non valida: controlla l'indirizzo dello script e che sia pubblicato per Chiunque" | In "Chi ha accesso" non c'è "Chiunque", oppure l'indirizzo non è quello `/exec`. Rifai il passo 2. |
| "Impossibile aprire il file in questo momento" durante il deployment | Sei collegato con più account Google: rifai il passo 2 in una finestra privata con un solo account. |
| "Google Drive non raggiungibile" | Manca la rete. L'app continua a funzionare e salva appena torna la rete. |
| Un titolo dice "non trovato su Google" | Il codice Google Finance non è giusto o quella borsa non è coperta. Prova un'altra borsa, o scrivi più codici separati da spazio. |
| Un prezzo automatico è molto diverso da quello della banca | Il codice punta a una borsa con un'altra valuta. Controlla la valuta del prezzo nel titolo. |
| "Per questa funzione aggiorna lo script Google alla versione 1.1" | Lo script è di una versione precedente. Segui "Aggiornare lo script". |
| La schermata "Collegato! Ora i dati" compare su un Drive che dovrebbe avere già i dati | Lo script appartiene a un altro account Google, oppure `dati.json` è stato spostato o rinominato. Controlla che in **Finanze** su Drive ci sia `dati.json`. Se hai un backup, usa **Carica un dati.json**. |
| Il foglio Google non mostra un dato nuovo | In **Impostazioni** tocca **Aggiorna il foglio Google adesso**. |
| Gli importi sono tutti puntini | È attivo l'occhio in alto: toccalo per mostrarli. |
| Android dice "Questa app non può essere installata" | Il sito dell'app è privato o richiede un login. Va reso pubblico. Poi in Chrome cancella i dati del sito e riprova. |
| Dopo un aggiornamento vedi ancora la versione vecchia | Chiudi del tutto l'app e riaprila, anche due volte. La versione è scritta in **Impostazioni**. |

`dati-vuoti.json` serve solo se "Inizia da zero" non funziona: in quel caso, nella schermata "Collegato! Ora i dati", tocca **Carica un dati.json** e scegli quel file.

## Riferimento tecnico (per assistenti AI e per chi è curioso)

Fatti utili per aiutare qualcuno a configurare o a risolvere un problema. Non servono per l'uso normale.

- L'app è una PWA statica (HTML, CSS, JavaScript) senza server proprio. Non ha dati personali nel codice. Usa la libreria ExcelJS (in `lib/`) per leggere l'export di Money Manager e scrivere l'Excel.
- L'app chiama lo script con richieste `POST` all'indirizzo `/exec`, con corpo JSON inviato come `text/plain` (così il browser non fa la richiesta preliminare CORS). Il corpo contiene `key` (la chiave) e `action`.
- Azioni dello script: `load` (legge i dati; risponde anche se il foglio va ricostruito e se l'aggiornamento serale è attivo), `save` (salva tutto il file, con controllo di versione), `sheet` (ricrea il foglio di riepilogo con le tabelle calcolate dall'app), `prezzi` (prezzi da Google Finance per una lista di codici e cambi verso l'euro), `serale` (accende o spegne l'aggiornamento serale), `backups` (elenco dei backup), `restore` (ripristino). Una richiesta `GET` all'indirizzo `/exec` risponde solo con "Il ponte Finanze è attivo." e serve come controllo.
- I prezzi si leggono scrivendo formule `GOOGLEFINANCE(codice,"price")` in un foglio nascosto `_prezzi` del foglio di riepilogo. L'aggiornamento serale è un attivatore a tempo dello script (funzione `aggiornamentoSerale`), che si può gestire anche dall'editor con `attivaAggiornamentoSerale` e `disattivaAggiornamentoSerale`.
- Risposte di errore dello script: `{"error":"chiave"}` se la chiave non corrisponde; `{"notFound":true}` se `dati.json` non esiste ancora (l'app allora propone "Inizia da zero"); `{"conflict":true,...}` se un altro dispositivo ha salvato nel frattempo (l'app unisce le modifiche da sola).
- File su Google Drive: cartella `Finanze` nella radice del Drive, con `dati.json`, il foglio `Finanze (riepilogo)` e la sottocartella `backup`.
- Sul dispositivo l'app tiene solo l'indirizzo dello script, la chiave, alcune preferenze (per esempio gli importi nascosti) e una copia dei dati per funzionare offline. "Scollega questo dispositivo" in Impostazioni cancella tutto questo.
- Struttura di `dati.json`:
  - `movimenti`: ognuno con `id`, `d` (data e ora `AAAA-MM-GGTHH:MM`), `t` (`u` uscita, `e` entrata), `c` categoria, `s` sottocategoria, `n` nota, `a` conto, `e` importo in euro; per le valute estere anche `cur` (valuta) e `v` (importo in valuta).
  - `categorie`: `u` (uscite) ed `e` (entrate), ognuna con `nome`, `colore`, `sub` (sottocategorie). `conti`: elenco dei conti.
  - `titoli` (`nome`, `breve`, `isin`, `classe`, `prezzo`, `prezzoAl`, `valuta`, `ticker`, `mantieni`), `acquisti` (`titolo`, `data`, `quote`, `prezzo`, `nota`), `depositi` (`nome`, `inizio`, `importo`, `tasso`, `scadenza`, `svincolabile`), `fondo` (`posizione`, `posizioneAl`, `versato`, `ter`, `anni`, `rendimenti`), `storico` (un punto al giorno del valore di depositi, titoli, carico, fondo, versato e liquidità).
  - `config`: nomi delle sezioni, ritenuta, bollo, tassa sulle plusvalenze, liquidità, liquidità da investire, obiettivi per classe, soglia, spese mensili e mesi del fondo di emergenza, valute e cambi, data dei prezzi.
- Regole da rispettare quando si aiuta qualcuno:
  1. Non chiedere mai la chiave a voce alta in un canale pubblico e non scriverla in file che vanno sul sito.
  2. Non modificare `dati.json` a mano mentre l'app è aperta su un dispositivo: si rischia di perdere modifiche. Per correggere dati, usare l'app; per tornare indietro, usare i backup.
  3. Per aggiornare lo script usare sempre **Gestisci deployment** e **Nuova versione**, mai un nuovo deployment, e conservare la chiave.
  4. Lo script va eseguito come **Me** e con accesso **Chiunque**; altre combinazioni non funzionano con l'app.
  5. I calcoli dell'app sono indicativi: non presentarli come consulenza finanziaria.
