import { define } from "../utils.ts";
import { BLOG_POSTS } from "../content/blog_posts.ts";
import { SITE_URL } from "../utils/seo.ts";

/**
 * Généré depuis content/blog_posts.ts plutôt que maintenu à la main
 * (cf. l'ancien static/sitemap.xml, remplacé par cette route) : le blog est
 * passé de 3 à 11 articles d'un coup, exactement le risque d'oubli déjà
 * noté dans ce fichier avant sa suppression — plus la peine d'y penser à
 * chaque nouvel article.
 *
 * Les pages personnalisées (/fil, /messages, /profil, /inviter) restent
 * volontairement absentes, comme avant (cf. robots.txt : jamais utiles à
 * un robot, redirigent un visiteur non connecté).
 */
interface SitemapEntry {
  loc: string;
  changefreq: "weekly" | "monthly" | "yearly";
  priority: string;
}

const STATIC_PAGES: SitemapEntry[] = [
  { loc: "/", changefreq: "weekly", priority: "1.0" },
  { loc: "/rejoindre", changefreq: "monthly", priority: "0.8" },
  { loc: "/connexion", changefreq: "monthly", priority: "0.3" },
  { loc: "/a-propos", changefreq: "monthly", priority: "0.5" },
  { loc: "/blog", changefreq: "weekly", priority: "0.6" },
];

function buildSitemapXml(): string {
  const entries: SitemapEntry[] = [
    ...STATIC_PAGES,
    ...BLOG_POSTS.map((post): SitemapEntry => ({
      loc: `/blog/${post.slug}`,
      changefreq: "yearly",
      priority: "0.5",
    })),
  ];

  const urls = entries.map((entry) =>
    `  <url>\n` +
    `    <loc>${SITE_URL}${entry.loc}</loc>\n` +
    `    <changefreq>${entry.changefreq}</changefreq>\n` +
    `    <priority>${entry.priority}</priority>\n` +
    `  </url>`
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export const handler = define.handlers({
  GET() {
    return new Response(buildSitemapXml(), {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        // Régénéré à chaque requête (coût négligeable, tableau en mémoire)
        // mais son contenu ne change qu'au déploiement d'un nouvel
        // article : un cache court reste utile face aux robots qui le
        // relisent souvent.
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
});
