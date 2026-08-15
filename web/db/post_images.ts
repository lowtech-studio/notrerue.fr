import { and, eq, isNull } from "drizzle-orm";
import { db } from "./client.ts";
import { post, postImage } from "./schema.ts";

export type PostImage = typeof postImage.$inferSelect;

// L'insertion vit dans `createPost` (cf. db/posts.ts) : elle doit se faire
// dans la même transaction que la demande elle-même (une photo sans
// demande, ou l'inverse, n'a pas de sens), donc sur le même `tx` — pas de
// fonction dédiée ici qui rouvrirait sa propre transaction.

export interface ViewablePostImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Photo pour affichage (routes/photos/[id].ts), seulement si `viewerStreetId`
 * correspond à la rue enregistrée sur la photo (cf. schema.ts : dénormalisée
 * depuis la rue de l'auteur à l'upload) ET que la demande associée n'est pas
 * supprimée — une demande soft-deletée ne doit plus rendre sa photo
 * consultable, même par un ancien voisin qui aurait gardé l'URL. `null` sinon,
 * sans distinguer "n'existe pas" de "pas le droit" (cf. le même principe sur
 * `getPostSummary`/`resolvePostContext`) : rien à apprendre de plus à qui
 * devine un identifiant.
 */
export async function findViewablePostImage(
  imageId: number,
  viewerStreetId: number,
): Promise<ViewablePostImage | null> {
  const [found] = await db.select({
    data: postImage.data,
    width: postImage.width,
    height: postImage.height,
  })
    .from(postImage)
    .innerJoin(post, eq(postImage.postId, post.id))
    .where(
      and(
        eq(postImage.id, imageId),
        eq(postImage.streetId, viewerStreetId),
        isNull(post.deletedAt),
      ),
    );
  return found ?? null;
}
