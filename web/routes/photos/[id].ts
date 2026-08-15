import { define } from "../../utils.ts";
import { findViewablePostImage } from "../../db/post_images.ts";

/**
 * Sert la photo jointe à une demande (cf. schema.ts#postImage, backlog
 * « ajouter des pièces jointes... si c'est une image »). Toujours du JPEG
 * (cf. utils/image.ts : ré-encodée systématiquement à l'upload), jamais les
 * octets d'origine envoyés par l'utilisateur.
 *
 * Auth + appartenance à la rue vérifiées ici comme sur /fil, /messages...
 * (cf. AGENTS.md « Le contenu d'une rue, si vous n'y habitez pas ») : une
 * `<img>` ne peut pas être redirigée vers /connexion de façon utile, donc
 * 404 plutôt que la redirection habituelle — invisible pour l'utilisateur
 * (l'UI ne construit jamais cette URL sans y avoir droit), et ne distingue
 * pas "n'existe pas" de "pas le droit" côté réponse (cf.
 * findViewablePostImage).
 */
export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) return new Response(null, { status: 404 });

    const id = Number(ctx.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return new Response(null, { status: 404 });
    }

    const image = await findViewablePostImage(id, user.street.id);
    if (!image) return new Response(null, { status: 404 });

    // Copié dans un `Uint8Array` neuf : le driver Postgres (postgres.js)
    // renvoie un `Buffer` Node pour une colonne `bytea` (cf. schema.ts), dont
    // le typage `ArrayBufferLike` (au lieu d'`ArrayBuffer`) n'est pas
    // accepté tel quel comme corps de `Response` par cette version de
    // TypeScript — recopier suffit à obtenir un type concret, sans cast.
    const body = new Uint8Array(image.data);

    return new Response(body, {
      headers: {
        "Content-Type": "image/jpeg",
        // Jamais réutilisée pour une autre photo (identifiant non recyclé,
        // pas d'édition possible) : `immutable` sans risque. `private` :
        // le contenu dépend de qui demande (appartenance à la rue), un
        // cache partagé (proxy, CDN) ne doit jamais le servir à un tiers.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  },
});
