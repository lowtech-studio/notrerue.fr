import { Head } from "fresh/runtime";
import "../assets/pages/a-propos.css" with { type: "css" };
import { define } from "../utils.ts";
import { Header } from "../components/Header.tsx";
import { SiteFooter } from "../components/SiteFooter.tsx";
import { jsonLd, SITE_URL } from "../utils/seo.ts";

/**
 * Renforce l'E-E-A-T (Expérience, Expertise, Autorité, Confiance — cf.
 * audit SEO/visibilité IA) : « qui édite ce site et pourquoi » est un
 * signal que Google et les moteurs génératifs valorisent, en plus d'être
 * simplement utile à un visiteur hésitant.
 */
const ABOUT_JSON_LD = jsonLd({
  "@context": "https://schema.org",
  "@type": "AboutPage",
  "@id": `${SITE_URL}/a-propos#webpage`,
  "url": `${SITE_URL}/a-propos`,
  "name": "À propos de NotreRue.fr",
  "isPartOf": { "@id": `${SITE_URL}/#website` },
  "about": { "@id": `${SITE_URL}/#organization` },
});

/**
 * Page statique, aucune donnée à charger : `state` (utilisateur, thème...)
 * vient directement du contexte de `define.page`, peuplé par
 * routes/_middleware.ts — pas de `handler` nécessaire ici (même situation
 * que routes/_app.tsx, qui n'en a pas non plus).
 */
export default define.page(function AProposPage({ state }) {
  return (
    <>
      <Head>
        <title>À propos — NotreRue.fr</title>
        <meta
          name="description"
          content="NotreRue.fr est un projet édité par le LowTech.studio : c'est une plateforme d'entraide de voisinage rue par rue, gratuite, open source et hébergée en France, sans revente de données."
        />
        <script
          type="application/ld+json"
          // JSON-LD statique/auteur, cf. le raisonnement dans _app.tsx.
          // deno-lint-ignore react-no-danger
          dangerouslySetInnerHTML={{ __html: ABOUT_JSON_LD }}
        />
      </Head>
      <Header
        user={state.user}
        isStreetAwake={state.isStreetAwake}
        theme={state.theme}
        hasUnreadMessages={state.hasUnreadMessages}
      />
      <main>
        <section class="container hero hero--single">
          <div>
            <p class="hero__eyebrow">À propos</p>
            <h1 class="hero__title">Pourquoi NotreRue.fr existe</h1>

            <div class="about-content">
              <p>
                NotreRue.fr est un projet du LowTech.studio : une plateforme
                d'entraide de voisinage, pensée rue par rue plutôt que ville par
                ville, pour que l'échange reste à taille humaine — un trajet à
                pied, pas un flux sans fin.
              </p>
              <p>
                Le principe est simple : chaque rue n'est accessible qu'à ses
                habitants réels, vérifiés par un voisin déjà inscrit avant de
                pouvoir publier ou écrire à quelqu'un. Pas de flux global, pas
                d'algorithme qui pousse du contenu extérieur, pas de revente de
                données à des tiers juste des échanges entre voisins.
              </p>
              {
                /* Formulé au niveau du projet (sa conviction, reprise de
                son propre positionnement — cf. llms.txt), pas comme une
                anecdote personnelle : je ne peux pas inventer le déclic
                réel qui a mené Fernando à lancer ce projet sans le
                fabriquer. Ce paragraphe reste à enrichir d'un vrai souvenir
                personnel si vous voulez le rendre plus fort (cf. dossier
                SEO, section 05 — c'est souvent ce qui convainc le plus). */
              }
              <p>
                On connaît parfois mieux des inconnus à l'autre bout du monde
                que les gens qui habitent à quelques portes de chez nous.
                NotreRue.fr part de cette conviction, sans chercher à réinventer
                le voisinage — juste à lui donner un endroit sain et souverain
                pour exister.
              </p>
              <p>
                C'est un projet « low-tech » assumé : le code est entièrement
                ouvert (
                <a
                  href="https://github.com/lowtech-studio/notrerue.fr"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  consultable sur GitHub
                </a>
                ), hébergé en France sur une infrastructure volontairement
                sobre, sans collecte superflue de données. Gratuit, sans
                abonnement caché, financé par quelques publicités discrètes et
                des dons.
              </p>
              <p class="about-content__signature">
                Notre-Rue vise un objectif simple :{" "}
                <strong>nous rapprocher les uns des autres.</strong>.
              </p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
});
