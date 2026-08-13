import { define } from "../utils.ts";

export default define.page(function App({ Component, state }) {
  return (
    <html lang="fr" data-theme={state.theme ?? undefined}>
      <head>
        <meta charset="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover"
        />
        <meta
          name="description"
          content="NotreRue.fr, la plateforme d'entraide entre voisins d'une même rue : partage, troc, jardin partagé et sécurité collective."
        />
        <title>NotreRue.fr — Créer du lien entre voisins</title>

        {/* PWA : manifest, icônes et intégration écran d'accueil */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" type="image/svg+xml" href="/icon.svg" />
        <link rel="apple-touch-icon" href="/icon.svg" />
        {
          /* Couleur de la barre système (Android/PWA), alignée sur le fond
            de l'en-tête (--color-paper) : deux balises plutôt qu'une seule
            dynamique — un navigateur qui ignore `media` retombe sur la
            première (mode clair), un navigateur qui le respecte choisit la
            bonne selon la préférence système (même logique que le mode
            sombre du reste du site, cf. common.css). */
        }
        <meta
          name="theme-color"
          content="#9a3f12"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#1c1814"
          media="(prefers-color-scheme: dark)"
        />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="NotreRue" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
});
