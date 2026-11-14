/* Salviamo la Bonetti – piccoli comportamenti della pagina.
   La pagina funziona anche senza questo file: qui si aggiornano solo
   il contatore, i pulsanti di condivisione e la barra in basso. */
(function () {
  "use strict";

  var cfg = (document.getElementById("campagna") || document.body).dataset;
  var firme = parseInt(cfg.firme, 10) || 0;
  var obiettivo = parseInt(cfg.obiettivo, 10) || 1000;
  var aggiornato = cfg.aggiornato || "";
  var mancano = Math.max(obiettivo - firme, 0);
  // 1000 -> "1.000"
  var numero = function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "."); };

  // ---- contatore delle firme ----
  var scrivi = function (selettore, testo) {
    document.querySelectorAll(selettore).forEach(function (el) { el.textContent = testo; });
  };
  scrivi(".js-firme", numero(firme));
  scrivi(".js-obiettivo", numero(obiettivo));
  scrivi(".js-mancano", numero(mancano));
  if (aggiornato) scrivi(".js-aggiornato", aggiornato);

  var barra = document.querySelector(".ring__bar");
  if (barra) {
    var giro = 2 * Math.PI * 104;
    var quota = Math.min(firme / obiettivo, 1);
    var arrivo = giro * (1 - quota);
    var fermo = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    barra.setAttribute("stroke-dasharray", giro.toFixed(2));
    if (fermo) {
      barra.setAttribute("stroke-dashoffset", arrivo.toFixed(2));
    } else {
      barra.style.transition = "none";
      barra.setAttribute("stroke-dashoffset", giro.toFixed(2));
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          barra.style.transition = "";
          barra.setAttribute("stroke-dashoffset", arrivo.toFixed(2));
        });
      });
    }
    var cifra = document.querySelector(".ring__num .js-firme");
    if (cifra && !fermo && window.requestAnimationFrame) {
      var inizio = null, durata = 1400;
      var passo = function (ora) {
        if (inizio === null) inizio = ora;
        var k = Math.min((ora - inizio) / durata, 1);
        var morbido = 1 - Math.pow(1 - k, 3);
        cifra.textContent = numero(Math.round(firme * morbido));
        if (k < 1) requestAnimationFrame(passo);
      };
      requestAnimationFrame(passo);
    }
    var titolo = document.getElementById("ring-t");
    if (titolo) titolo.textContent = numero(firme) + " firme raccolte su " + numero(obiettivo);
  }

  // ---- giorni che restano per firmare ----
  var scadenza = (cfg.scadenza || "").split("-").map(Number);
  if (scadenza.length === 3) {
    var oggi = new Date();
    var giorni = Math.round((Date.UTC(scadenza[0], scadenza[1] - 1, scadenza[2]) -
      Date.UTC(oggi.getFullYear(), oggi.getMonth(), oggi.getDate())) / 86400000);
    if (giorni > 1) {
      scrivi(".js-giorni-frase", "Restano " + giorni + " giorni: la raccolta chiude l'11 marzo 2027.");
    }
  }

  // ---- indirizzo da condividere ----
  // Sul sito pubblico si condivide l'indirizzo della pagina stessa, così il link
  // resta giusto anche quando cambia il dominio.
  var sito = cfg.sito || "";
  var host = location.hostname || "";
  if (/^https?:$/.test(location.protocol) && host && !/claude|localhost|127\.0\.0\.1/.test(host)) {
    sito = location.origin + location.pathname;
  }

  var wa = document.querySelector(".js-whatsapp");
  if (wa && sito) {
    var messaggio = "Salviamo la Bonetti: la scuola primaria di via Tajani 12 rischia di chiudere. " +
      "Servono 1.000 firme, bastano pochi minuti con SPID o CIE. " + sito;
    wa.href = "https://wa.me/?text=" + encodeURIComponent(messaggio);
  }

  // ---- copia negli appunti ----
  var copia = function (testo) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(testo);
    }
    return Promise.reject(new Error("appunti non disponibili"));
  };
  var seleziona = function (el) {
    if (!el) return;
    var r = document.createRange();
    r.selectNodeContents(el);
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  };

  document.querySelectorAll(".js-copy").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var cosa = btn.dataset.copy;
      var testo = cosa === "mail" ? "salviamobonetti@gmail.com" : sito;
      var esito = document.getElementById(cosa === "mail" ? "copia-mail-esito" : "copia-esito");
      copia(testo).then(function () {
        if (esito) esito.textContent = cosa === "mail" ? "Indirizzo copiato." : "Link copiato: incollalo dove vuoi.";
      }).catch(function () {
        if (cosa === "mail") seleziona(document.getElementById("indirizzo-mail"));
        if (esito) esito.textContent = cosa === "mail" ? "Seleziona e copia l'indirizzo qui sopra." : "Copia questo indirizzo: " + testo;
      });
    });
  });

  // ---- barra "Firma ora" su telefono ----
  var dock = document.getElementById("dock");
  var cta = document.querySelector(".hero__cta");
  if (dock && cta && "IntersectionObserver" in window) {
    var link = dock.querySelector("a");
    new IntersectionObserver(function (voci) {
      var visibile = voci[0].isIntersecting;
      dock.classList.toggle("is-on", !visibile);
      dock.setAttribute("aria-hidden", visibile ? "true" : "false");
      if (link) link.tabIndex = visibile ? -1 : 0;
    }, { threshold: 0 }).observe(cta);
  }

  // ---- aggiornamenti: se sono tanti, mostra i primi cinque ----
  var lista = document.getElementById("lista-aggiornamenti");
  var tutti = document.getElementById("mostra-tutti");
  if (lista && tutti) {
    var voci = lista.querySelectorAll(".news");
    var LIMITE = 5;
    if (voci.length > LIMITE) {
      voci.forEach(function (v, i) { if (i >= LIMITE) v.hidden = true; });
      tutti.hidden = false;
      tutti.addEventListener("click", function () {
        voci.forEach(function (v) { v.hidden = false; });
        tutti.hidden = true;
      });
    }
  }
})();
