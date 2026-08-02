// Import CSS files here for hot module reloading to work.
import "./assets/styles.css";

// Enregistrement du service worker (PWA) : mise en cache pour un chargement
// hors-ligne résilient, voir static/sw.js.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}
