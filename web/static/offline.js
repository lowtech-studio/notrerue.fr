// Script du bouton "Réessayer" de static/offline.html (page de secours du
// service worker). Fichier externe pour rester compatible avec une future
// Content-Security-Policy sans 'unsafe-inline' (cf. AGENTS.md, Cyber sécurité).
document.getElementById("retry").addEventListener("click", () => {
  location.reload();
});
