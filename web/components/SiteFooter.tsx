/**
 * Pied de page commun — extrait de routes/index.tsx (seule page à
 * l'afficher jusqu'ici) pour être réutilisé sur /a-propos et /blog sans
 * dupliquer le balisage (cf. AGENTS.md « Fresh » : composant partagé plutôt
 * que copier-coller entre routes). Statique, aucune prop nécessaire.
 */
export function SiteFooter() {
  return (
    <footer class="site-footer">
      <nav class="container site-footer__nav">
        <a href="/a-propos" class="site-footer__link">À propos</a>
        <a href="/blog" class="site-footer__link">Blog</a>
      </nav>
      <p class="container site-footer__text">
        NotreRue.fr by LowTech.studio — « Nous rapprocher les uns des autres » |
        Souveraineté — Hebergement 100% Français 🇫🇷 et{" "}
        <a
          href="https://github.com/lowtech-studio/notrerue.fr"
          target="_blank"
          rel="noopener noreferrer"
          class="site-footer__link"
        >
          Code 100% Open Source
        </a>{" "}
        pas d'entourloupe !
      </p>
    </footer>
  );
}
