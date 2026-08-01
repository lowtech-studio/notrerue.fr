import { define } from "../utils.ts";

export default define.page(function App({ Component }) {
  return (
    <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta
          name="description"
          content="NotreRue.fr, la plateforme d'entraide entre voisins d'une même rue : partage, troc, jardin partagé et sécurité collective."
        />
        <title>NotreRue.fr — Créer du lien entre voisins</title>
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
});
