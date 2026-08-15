import { Head } from "fresh/runtime";
import "../../assets/pages/blog.css" with { type: "css" };
import { define } from "../../utils.ts";
import { Header } from "../../components/Header.tsx";
import { SiteFooter } from "../../components/SiteFooter.tsx";
import {
  formatBlogDate,
  listBlogPostsSortedByDate,
} from "../../content/blog_posts.ts";
import { jsonLd, SITE_URL } from "../../utils/seo.ts";

const BLOG_DESCRIPTION =
  "Des conseils ancrés dans le voisinage réel : entraide, confiance et bon sens entre habitants d'une même rue.";

/**
 * Page statique : la liste vient de content/blog_posts.ts, déjà triée par
 * `listBlogPostsSortedByDate` — pas de `handler` nécessaire (même situation
 * que routes/a-propos.tsx).
 */
export default define.page(function BlogIndexPage({ state }) {
  const posts = listBlogPostsSortedByDate();

  const blogJsonLd = jsonLd({
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${SITE_URL}/blog#blog`,
    "url": `${SITE_URL}/blog`,
    "name": "Blog NotreRue.fr",
    "description": BLOG_DESCRIPTION,
    "isPartOf": { "@id": `${SITE_URL}/#website` },
    "blogPost": posts.map((post) => ({
      "@type": "BlogPosting",
      "headline": post.title,
      "url": `${SITE_URL}/blog/${post.slug}`,
      "datePublished": post.publishedAt,
    })),
  });

  return (
    <>
      <Head>
        <title>Blog — NotreRue.fr</title>
        <meta name="description" content={BLOG_DESCRIPTION} />
        <script
          type="application/ld+json"
          // JSON-LD statique/auteur, cf. le raisonnement dans _app.tsx.
          // deno-lint-ignore react-no-danger
          dangerouslySetInnerHTML={{ __html: blogJsonLd }}
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
            <p class="hero__eyebrow">Blog</p>
            <h1 class="hero__title">Idées entre voisins</h1>
            <p class="hero__subtitle">{BLOG_DESCRIPTION}</p>
          </div>
        </section>

        <section class="container blog-list" aria-label="Articles">
          {posts.map((post) => (
            <a href={`/blog/${post.slug}`} class="blog-card" key={post.slug}>
              <p class="blog-card__date">
                <time dateTime={post.publishedAt}>
                  {formatBlogDate(post.publishedAt)}
                </time>
              </p>
              <h2 class="blog-card__title">{post.title}</h2>
              <p class="blog-card__desc">{post.description}</p>
              <span class="blog-card__cta" aria-hidden="true">
                Lire l'article →
              </span>
            </a>
          ))}
        </section>
      </main>
      <SiteFooter />
    </>
  );
});
