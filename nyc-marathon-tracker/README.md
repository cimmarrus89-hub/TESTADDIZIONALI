# NYC Marathon 2026 · Tracker live

Sito statico (HTML, CSS, JavaScript, nessuna dipendenza da installare) per seguire in diretta
i maratoneti della TCS New York City Marathon 2026 usando i risultati ufficiali NYRR.

## Come si usa

- **Su GitHub Pages** (consigliato, funziona dal telefono): metti questa cartella nel repository,
  attiva Pages (Settings → Pages → Deploy from a branch → branch `main`, cartella `/ (root)`)
  e apri `https://<utente>.github.io/<repository>/nyc-marathon-tracker/`.
- **In locale**: apri `index.html` nel browser, oppure `node server.js` e poi http://localhost:8080
  (il server fa anche da proxy verso le API NYRR se le chiamate dirette fossero bloccate).

## Funzioni

- Ricerca per nome, cognome o pettorale sui risultati NYRR; più maratoneti seguiti, ognuno con il suo colore.
- Mappa del percorso 2026 (strada per strada, con il nuovo tratto nel Bronx), posizione stimata tra un passaggio e l'altro,
  corone per i leader uomini e donne, "fantasma" del record del percorso.
- Passaggi ufficiali (5 km, 10 km, mezza, …), passo per tratto, grafico, previsione del tempo e dell'ora di arrivo (NY e Italia).
- Confronto con i leader e statistiche divertenti.
- Modalità **Simulazione** per provare tutto prima del via (cerca "Michele" o il pettorale 26210).

Il codice evento 2026 viene riconosciuto da solo appena NYRR lo pubblica; in caso di bisogno si può forzare
dalle impostazioni (es. `M2026`).

Progetto amatoriale non affiliato a NYRR. Mappa © OpenStreetMap contributors, sfondi alternativi © Esri.
