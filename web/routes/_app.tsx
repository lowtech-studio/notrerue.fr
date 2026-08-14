import { define } from "../utils.ts";
import {
  canonicalUrl,
  DEFAULT_DESCRIPTION,
  jsonLd,
  SITE_NAME,
  SITE_URL,
} from "../utils/seo.ts";

const DEFAULT_TITLE = "NotreRue.fr — Créer du lien entre voisins";
// Capture d'écran du fil, la plus représentative de l'app (cf.
// preview-wall dans routes/index.tsx) — sert d'aperçu de partage par
// défaut (og:image/twitter:image) tant qu'aucune image dédiée 1200×630
// n'existe : dimensions réelles déclarées ci-dessous pour rester honnête
// envers les plateformes qui les lisent avant de la récupérer.
const SHARE_IMAGE = { path: "/screenshots/fil.jpg", width: 465, height: 363 };

/**
 * Données structurées (JSON-LD) communes à toutes les pages — decrivent le
 * site lui-même (organisation éditrice + site web + application), pas le
 * contenu d'une page en particulier (cf. `FAQPage` propre à `index.tsx`
 * pour ça). Utile autant pour les moteurs de recherche classiques (Google
 * Rich Results) que pour les moteurs génératifs/LLM qui citent plus
 * volontiers une entité clairement typée et sourcée (GEO).
 */
const SITE_JSON_LD = jsonLd({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      "name": SITE_NAME,
      "url": SITE_URL,
      "logo": `${SITE_URL}/icon.svg`,
      "description": DEFAULT_DESCRIPTION,
      "areaServed": { "@type": "Country", "name": "France" },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      "url": SITE_URL,
      "name": SITE_NAME,
      "description": DEFAULT_DESCRIPTION,
      "publisher": { "@id": `${SITE_URL}/#organization` },
      "inLanguage": "fr-FR",
    },
    {
      "@type": "WebApplication",
      "name": SITE_NAME,
      "url": SITE_URL,
      "description": DEFAULT_DESCRIPTION,
      "applicationCategory": "SocialNetworkingApplication",
      "operatingSystem": "Tout navigateur web (installable en PWA)",
      "isAccessibleForFree": true,
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "EUR" },
    },
  ],
});

export default define.page(function App({ Component, state, url }) {
  const pageUrl = canonicalUrl(url.pathname);
  const shareImageUrl = `${SITE_URL}${SHARE_IMAGE.path}`;

  return (
    <html lang="fr" data-theme={state.theme ?? undefined}>
      <head>
        <meta charset="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover"
        />
        <meta name="description" content={DEFAULT_DESCRIPTION} />
        <title>{DEFAULT_TITLE}</title>

        {
          /* URL canonique — toujours sans requête (cf. utils/seo.ts) : `/`
          reste `/` quels que soient les paramètres `?ville=...&rue=...`
          du formulaire de recherche de rue, pour ne pas exposer chaque
          combinaison comme une page distincte aux moteurs de recherche. */
        }
        <link rel="canonical" href={pageUrl} />

        {
          /* Open Graph + Twitter Card : aperçu de partage (réseaux sociaux,
          messageries, LLM avec navigation web) — cf. AGENTS.md
          éco-conception, pas de contenu superflu, juste ce que ces
          plateformes lisent réellement. */
        }
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={SITE_NAME} />
        <meta property="og:locale" content="fr_FR" />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:title" content={DEFAULT_TITLE} />
        <meta property="og:description" content={DEFAULT_DESCRIPTION} />
        <meta property="og:image" content={shareImageUrl} />
        <meta
          property="og:image:width"
          content={String(SHARE_IMAGE.width)}
        />
        <meta
          property="og:image:height"
          content={String(SHARE_IMAGE.height)}
        />
        <meta
          property="og:image:alt"
          content="Aperçu du fil d'une rue sur NotreRue.fr"
        />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={DEFAULT_TITLE} />
        <meta name="twitter:description" content={DEFAULT_DESCRIPTION} />
        <meta name="twitter:image" content={shareImageUrl} />

        {
          /* Données structurées JSON-LD (schema.org) : non exécuté comme
          script par le navigateur (type inerte), donc jamais bloqué par la
          CSP stricte de main.ts même sans nonce — cf. utils/seo.ts pour
          l'échappement qui rend cette injection sûre. Contenu 100%
          statique/auteur (jamais de donnée utilisateur), donc pas la
          situation que la règle react-no-danger/AGENTS.md « Rendu HTML et
          XSS » vise à empêcher — seul moyen d'embarquer du JSON brut, que
          Preact échapperait (guillemets → entités) et casserait sinon. */
        }
        <script
          type="application/ld+json"
          // JSON-LD statique/auteur, cf. le commentaire ci-dessus.
          // deno-lint-ignore react-no-danger
          dangerouslySetInnerHTML={{ __html: SITE_JSON_LD }}
        />

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
