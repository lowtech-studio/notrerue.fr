import { define } from "../utils.ts";

export default define.page(function App({ Component }) {
  return (
    <html lang="fr">
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
        <meta name="theme-color" content="#9a3f12" />
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
