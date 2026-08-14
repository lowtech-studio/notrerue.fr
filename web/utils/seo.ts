/**
 * Constantes et petits utilitaires SEO/GEO (référencement moteurs de
 * recherche + moteurs génératifs/LLM) partagés entre `routes/_app.tsx` (URL
 * canonique, Open Graph, JSON-LD `Organization`/`WebSite`) et les pages
 * publiques qui ajoutent leurs propres données structurées (ex. `FAQPage`
 * dans `routes/index.tsx`) — extraits ici pour rester testables sans rendu
 * complet d'une page (même logique que `utils/csp.ts`).
 */

export const SITE_URL = "https://notrerue.fr";
export const SITE_NAME = "NotreRue.fr";

/**
 * Description par défaut, reprise en `<meta name="description">`,
 * `og:description` et `twitter:description` (cf. `routes/_app.tsx`) — un
 * habitant vérifié par ses voisins, gratuit, sans publicité ni revente de
 * données : les trois mots-clés qui reviennent dans les recherches "site
 * entraide voisins gratuit" / "alternative Nextdoor France".
 */
export const DEFAULT_DESCRIPTION =
  "NotreRue.fr, la plateforme gratuite d'entraide entre voisins d'une même rue : partage, troc, jardin partagé et recommandations de confiance — sans publicité ni revente de données, hébergée en France.";

/**
 * URL absolue et canonique pour un chemin donné — toujours sans requête ni
 * fragment : `/` reste `/` quel que soit `?ville=...&rue=...` (cf.
 * `routes/index.tsx`, formulaire de recherche de rue en GET), pour ne pas
 * faire apparaître chaque combinaison comme une page distincte aux yeux des
 * moteurs de recherche (contenu dupliqué).
 */
export function canonicalUrl(pathname: string): string {
  return `${SITE_URL}${pathname}`;
}

/**
 * Sérialise des données structurées (JSON-LD) en échappant `<` pour ne
 * jamais laisser passer une séquence `</script>` qui interromprait
 * prématurément la balise `<script type="application/ld+json">` dans
 * laquelle ce texte est injecté via `dangerouslySetInnerHTML` (cf.
 * `routes/_app.tsx`) — contenu 100% statique/auteur ici, jamais de données
 * utilisateur, donc pas la même situation que l'interdiction de
 * `dangerouslySetInnerHTML` sur du contenu utilisateur (cf. AGENTS.md
 * « Rendu HTML et XSS ») : JSON-LD ne peut de toute façon pas être exprimé
 * en JSX sans que Preact n'échappe les guillemets et casse le JSON.
 */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}
