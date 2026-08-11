// Styles communs à toutes les pages (reset, tokens, en-tête, boutons...) ;
// les styles propres à une seule page sont importés depuis cette page (cf.
// assets/common.css, backlog « un fichier par page + un fichier commun »).
import "./assets/common.css" with { type: "css" };

// Enregistrement du service worker (PWA) : mise en cache pour un chargement
// hors-ligne résilient, voir static/sw.js.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}
