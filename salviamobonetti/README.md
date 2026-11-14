# Salviamo la Bonetti – sito della campagna

Sito informativo per la petizione "Salviamo la scuola Bonetti di via Tajani" (Milano, Città Studi).
È una pagina sola, senza programmi da installare: bastano i file di questa cartella.

## Cosa c'è dentro

| File | A cosa serve |
| --- | --- |
| `index.html` | Tutti i testi della pagina |
| `assets/css/style.css` | Colori, caratteri, impaginazione |
| `assets/js/app.js` | Contatore delle firme, pulsanti di condivisione, barra "Firma ora" |
| `assets/img/` | Logo, volantino, immagine di anteprima per WhatsApp (`og.jpg`) |
| `assets/fonts/` | Caratteri (Bricolage Grotesque e DM Sans, licenza OFL), serviti dal sito stesso |

## Aggiornare il contatore delle firme

In `index.html`, in alto, c'è questo blocco:

```html
<div id="campagna" hidden
     data-firme="559" data-obiettivo="1000" data-aggiornato="14 novembre 2026"
```

Basta cambiare `data-firme` e `data-aggiornato`: anello, "ne mancano" e barra in basso si aggiornano da soli.

## Pubblicare un aggiornamento

In `index.html`, nella sezione `AGGIORNAMENTI`, copiare un blocco come questo e incollarlo **in cima** alla lista:

```html
<article class="news">
  <time datetime="2026-11-20">20 novembre 2026</time>
  <div>
    <h3>Titolo dell'aggiornamento</h3>
    <p>Testo dell'aggiornamento.</p>
  </div>
</article>
```

Se gli aggiornamenti superano i cinque, i più vecchi finiscono dietro il pulsante "Mostra tutti".

## Indirizzo del sito

Finché il sito sta su GitHub Pages l'indirizzo è
`https://cimmarrus89-hub.github.io/TESTADDIZIONALI/salviamobonetti/`.

Quando sarà collegato il dominio `salviamobonetti.it`, sostituire quell'indirizzo in `index.html`
(righe `canonical`, `og:url`, `og:image` e `data-sito`).

## Regole per i testi

- Solo fatti che risultano dagli atti pubblici o dalla petizione, con la fonte in fondo alla pagina.
- Nessun dato personale dei bambini o delle famiglie.
- Il sito non usa cookie né strumenti di tracciamento.
