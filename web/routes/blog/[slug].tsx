import { Head } from "fresh/runtime";
import "../../assets/pages/blog.css" with { type: "css" };
import { define } from "../../utils.ts";
import { Header } from "../../components/Header.tsx";
import { SiteFooter } from "../../components/SiteFooter.tsx";
import {
  type BlogPost,
  findBlogPostBySlug,
  formatBlogDate,
} from "../../content/blog_posts.ts";
import { jsonLd, SITE_URL } from "../../utils/seo.ts";

/**
 * `slug` inconnu → 404 texte brut, même logique que routes/photos/[id].ts
 * (pas de contenu utilisateur ici, mais un lien externe ou favori périmé
 * doit échouer proprement plutôt que planter).
 */
export const handler = define.handlers({
  GET(ctx) {
    const post = findBlogPostBySlug(ctx.params.slug);
    if (!post) {
      return new Response("Article introuvable.", { status: 404 });
    }
    return { data: post };
  },
});

export default define.page<typeof handler>(function BlogPostPage({
  data,
  state,
}) {
  const post: BlogPost = data;

  // Un lecteur venu d'une recherche n'a pas encore de compte : /inviter (le
  // générateur de kit) redirige sans lui vers /connexion, une impasse pour
  // qui n'a jamais eu de compte à connecter. /rejoindre (créer sa rue) est
  // la vraie première étape ; générer le kit vient juste après, une fois
  // inscrit — d'où la bascule selon `state.user` (cf. discussion du
  // 16/08 sur le funnel).
  const ctaHref = state.user ? "/inviter" : "/rejoindre";

  const articleJsonLd = jsonLd({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${SITE_URL}/blog/${post.slug}#article`,
    "headline": post.title,
    "description": post.description,
    "url": `${SITE_URL}/blog/${post.slug}`,
    "datePublished": post.publishedAt,
    "inLanguage": "fr-FR",
    "isPartOf": { "@id": `${SITE_URL}/blog#blog` },
    "publisher": { "@id": `${SITE_URL}/#organization` },
    "mainEntityOfPage": `${SITE_URL}/blog/${post.slug}`,
  });

  return (
    <>
      <Head>
        <title>{post.title} — NotreRue.fr</title>
        <meta name="description" content={post.description} />
        <script
          type="application/ld+json"
          // JSON-LD statique/auteur, cf. le raisonnement dans _app.tsx.
          // deno-lint-ignore react-no-danger
          dangerouslySetInnerHTML={{ __html: articleJsonLd }}
        />
      </Head>
      <Header
        user={state.user}
        isStreetAwake={state.isStreetAwake}
        theme={state.theme}
        hasUnreadMessages={state.hasUnreadMessages}
      />
      <main>
        <article class="container hero hero--single">
          <div>
            <p class="hero__eyebrow">
              <a href="/blog" class="blog-article__back">← Blog</a>
            </p>
            <h1 class="hero__title">{post.title}</h1>
            <p class="blog-article__date">
              <time dateTime={post.publishedAt}>
                {formatBlogDate(post.publishedAt)}
              </time>
            </p>

            {
              /* `intro` répété en tête de l'article, en évidence : la
              réponse directe que Google/les moteurs IA peuvent citer seule
              (cf. dossier SEO section 03-E), avant le développement en
              `body`. */
            }
            <p class="blog-article__intro">{post.intro}</p>

            <div class="blog-article__body">
              {post.body.map((paragraph, i) => <p key={i}>{paragraph}</p>)}
            </div>

            <div class="blog-article__cta">
              <p>Vous voulez le faire dans votre rue ?</p>
              <a href={ctaHref} class="button">Générez votre kit</a>
            </div>
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
});
