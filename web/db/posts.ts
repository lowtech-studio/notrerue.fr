import {
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { db } from "./client.ts";
import { comment, house, post, postImage, postType, user } from "./schema.ts";
import { escapeLikePattern } from "../utils/validation.ts";

export type Post = typeof post.$inferSelect;
export type PostType = (typeof postType.enumValues)[number];

/**
 * Libellé du bouton de réponse en un clic, selon le type de la demande (cf.
 * backlog) — partagé entre routes/fil.tsx (bouton) et email/brevo.ts
 * (notification de tap), pour ne pas dupliquer le même mapping.
 */
export const TAP_LABELS: Record<PostType, string> = {
  cherche: "J'ai",
  propose: "Intéressé",
  informe: "👍",
};

/**
 * Une demande tient en une phrase (cf. backlog « publier en moins de 30
 * secondes ») : limite courte, façon SMS, plutôt qu'un article.
 */
export const MAX_POST_CONTENT_LENGTH = 240;

/** Recherche libre sur /fil, et bornage des champs `q` repris tels quels par /taps et /reponses (cf. backlog « retrouver les réponses déjà données ») — large, une longue phrase collée reste inoffensive vu le `ilike` en base. */
export const MAX_SEARCH_LENGTH = 100;

/** Vrai si `value` est bien l'une des trois valeurs de l'enum `post_type`. */
export function isPostType(value: string): value is PostType {
  return (postType.enumValues as readonly string[]).includes(value);
}

/**
 * Durée de validité choisie à la publication (cf. backlog « le fil ne se
 * remplisse pas de demandes mortes »). `"months"` est complété par un nombre
 * de mois (cf. `MIN_POST_DURATION_MONTHS`/`MAX_POST_DURATION_MONTHS`), les
 * deux autres sont des durées fixes.
 */
export const POST_DURATIONS = ["today", "week", "months"] as const;
export type PostDuration = (typeof POST_DURATIONS)[number];

export function isPostDuration(value: string): value is PostDuration {
  return (POST_DURATIONS as readonly string[]).includes(value);
}

export const MIN_POST_DURATION_MONTHS = 1;
export const MAX_POST_DURATION_MONTHS = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Date d'expiration à enregistrer sur la demande, depuis la durée choisie.
 * `months` n'est utilisé (et validé/plafonné) que pour `duration ===
 * "months"` ; ignoré sinon. Durée fixe depuis l'instant de publication —
 * pas de calage sur la fin de journée calendaire, aucun fuseau horaire par
 * habitant n'étant stocké.
 */
export function computeExpiresAt(
  duration: PostDuration,
  months: number,
  now: Date = new Date(),
): Date {
  if (duration === "today") return new Date(now.getTime() + DAY_MS);
  if (duration === "week") return new Date(now.getTime() + 7 * DAY_MS);

  const clampedMonths = Math.min(
    Math.max(
      Math.round(months) || MIN_POST_DURATION_MONTHS,
      MIN_POST_DURATION_MONTHS,
    ),
    MAX_POST_DURATION_MONTHS,
  );
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + clampedMonths);
  return expiresAt;
}

/** Photo à joindre à la demande créée — déjà redimensionnée/ré-encodée par l'appelant (cf. utils/image.ts), `createPost` ne fait qu'enregistrer le résultat. */
export interface CreatePostImageInput {
  streetId: number;
  data: Uint8Array;
  width: number;
  height: number;
}

export interface CreatePostInput {
  userId: number;
  type: PostType;
  content: string;
  /**
   * Calculée par l'appelant via `computeExpiresAt` (cf. backlog « choisir
   * la durée de validité de ma demande à chaque publication ») ; la route
   * /fil rend ce choix obligatoire. Optionnelle ici seulement pour ne pas
   * forcer chaque appelant existant (tests, scripts) à s'en soucier —
   * retombe sur une semaine si omise.
   */
  expiresAt?: Date;
  /** Cf. backlog « ajouter des pièces jointes... si c'est une image » — absente si la demande n'en a pas. */
  image?: CreatePostImageInput;
}

/**
 * Enregistre une demande, et sa photo le cas échéant, dans la même
 * transaction (cf. schema.ts#postImage : relation 1-1, l'une n'a pas de
 * sens sans l'autre). Aucune vérification d'appartenance à une rue ici (le
 * foyer de l'auteur la détermine déjà) ni de modération : ces contrôles
 * sont faits par l'appelant (route) avant insertion.
 */
export async function createPost(input: CreatePostInput): Promise<Post> {
  return await db.transaction(async (tx) => {
    const [created] = await tx.insert(post).values({
      userId: input.userId,
      type: input.type,
      content: input.content,
      expiresAt: input.expiresAt ?? computeExpiresAt("week", 1),
    }).returning();

    if (input.image) {
      await tx.insert(postImage).values({
        postId: created.id,
        streetId: input.image.streetId,
        data: input.image.data,
        width: input.image.width,
        height: input.image.height,
      });
    }

    return created;
  });
}

/**
 * Corrige le contenu d'une demande (cf. backlog « corriger des erreurs de
 * saisie ») — seulement le texte, pas le type ni la durée : une coquille se
 * corrige, une demande ne change pas de nature après coup. `null` si
 * `postId` n'existe pas, n'appartient pas à `userId` ou est déjà supprimée
 * (vérifié en base, pas seulement côté UI — cf. `toggleTap` pour la même
 * précaution).
 */
export async function updatePostContent(
  postId: number,
  userId: number,
  content: string,
): Promise<Post | null> {
  const [updated] = await db.update(post)
    .set({ content })
    .where(
      and(eq(post.id, postId), eq(post.userId, userId), isNull(post.deletedAt)),
    )
    .returning();
  return updated ?? null;
}

/**
 * Supprime (soft delete) une demande — invisible dès lors partout
 * (`listStreetPosts`/`getPostSummary` filtrent déjà `isNull(post.deletedAt)`),
 * sans effacer taps/commentaires déjà associés. Vrai seulement si une ligne
 * appartenant à `userId` et pas déjà supprimée a été trouvée.
 */
export async function softDeletePost(
  postId: number,
  userId: number,
): Promise<boolean> {
  const updated = await db.update(post)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(post.id, postId), eq(post.userId, userId), isNull(post.deletedAt)),
    )
    .returning({ id: post.id });
  return updated.length > 0;
}

/**
 * Supprime (soft delete) toutes les demandes encore actives d'un habitant —
 * utilisé par la suppression de compte (cf.
 * db/account.ts#deleteUserAccount), pas de vérification d'appartenance ici
 * puisque déjà filtré par `userId`.
 */
export async function softDeleteUserPosts(userId: number): Promise<void> {
  await db.update(post)
    .set({ deletedAt: new Date() })
    .where(and(eq(post.userId, userId), isNull(post.deletedAt)));
}

/** Nombre de demandes affichées par page du fil (cf. backlog éco-conception : pagination plutôt que défilement infini). */
export const POSTS_PER_PAGE = 20;

export interface StreetPost {
  id: number;
  type: PostType;
  content: string;
  createdAt: Date;
  authorId: number;
  authorLogin: string;
  /**
   * Photo jointe (cf. schema.ts#postImage), sans ses octets : juste de quoi
   * construire `<img src="/photos/{id}">` avec `width`/`height` corrects
   * (cf. routes/fil.tsx) sans faire transiter du `bytea` à chaque ligne du
   * fil. `null` si la demande n'en a pas.
   */
  image: { id: number; width: number; height: number } | null;
}

export interface ListStreetPostsInput {
  streetId: number;
  /** Filtre optionnel par type ; les trois types si absent. */
  type?: PostType;
  /** Page 1-indexée. */
  page: number;
  /**
   * Recherche libre (cf. backlog « retrouver les réponses déjà données ») :
   * filtre sur la demande ET sur les réponses déjà publiées (cf.
   * `findPostIdsWithMatchingComment`) — la réponse cherchée est souvent un
   * nom d'artisan qui ne figure que dans une réponse, pas dans la demande
   * elle-même.
   */
  search?: string;
  /** N'est là que pour les tests (déterministe) ; sinon l'instant courant. */
  now?: Date;
}

export interface ListStreetPostsResult {
  posts: StreetPost[];
  totalCount: number;
  totalPages: number;
  /** Page réellement servie (`input.page` ramenée dans `[1, totalPages]`). */
  page: number;
}

/** Identifiants des demandes ayant au moins une réponse (non supprimée) contenant `search`. */
async function findPostIdsWithMatchingComment(
  search: string,
): Promise<number[]> {
  const pattern = `%${escapeLikePattern(search)}%`;
  const rows = await db.selectDistinct({ postId: comment.postId }).from(
    comment,
  ).where(and(ilike(comment.content, pattern), isNull(comment.deletedAt)));
  return rows.map((row) => row.postId).filter((id) => id !== null);
}

/**
 * Fil chronologique (plus récent d'abord) d'une seule rue, celle de
 * l'auteur — jamais toutes les rues confondues (cf. backlog « ma rue
 * seule »). Filtrable par type, paginé. Les demandes expirées (cf. backlog
 * « le fil ne se remplisse pas de demandes mortes ») sont exclues ;
 * `expiresAt` nul (demandes publiées avant l'ajout de cette fonctionnalité)
 * reste visible indéfiniment.
 */
export async function listStreetPosts(
  input: ListStreetPostsInput,
): Promise<ListStreetPostsResult> {
  const now = input.now ?? new Date();
  const search = input.search?.trim();
  const matchingCommentPostIds = search
    ? await findPostIdsWithMatchingComment(search)
    : [];
  const searchCondition = search
    ? or(
      ilike(post.content, `%${escapeLikePattern(search)}%`),
      matchingCommentPostIds.length > 0
        ? inArray(post.id, matchingCommentPostIds)
        : undefined,
    )
    : undefined;

  const where = and(
    eq(house.streetId, input.streetId),
    isNull(post.deletedAt),
    or(isNull(post.expiresAt), gt(post.expiresAt, now)),
    input.type ? eq(post.type, input.type) : undefined,
    searchCondition,
  );

  const selectPage = (page: number) =>
    db.select({
      id: post.id,
      type: post.type,
      content: post.content,
      createdAt: post.createdAt,
      authorId: user.id,
      authorLogin: user.login,
      // `leftJoin` : la grande majorité des demandes n'ont pas de photo, un
      // `innerJoin` les aurait exclues. Seules `id`/largeur/hauteur sont
      // sélectionnées ici, jamais `postImage.data` (cf. StreetPost.image) —
      // le poids des photos ne transite jamais par ce chemin, appelé à
      // chaque affichage du fil.
      imageId: postImage.id,
      imageWidth: postImage.width,
      imageHeight: postImage.height,
      // `count(*) over()` plutôt qu'un `SELECT count(...)` séparé (cf.
      // revue perf) : un aller-retour DB en moins à chaque affichage du fil
      // — la fenêtre porte sur toutes les lignes filtrées par `where`,
      // évaluée avant `LIMIT`/`OFFSET`, donc le total reste correct même
      // si la page ne ramène que 3 lignes. `.mapWith(Number)` : même
      // conversion que le helper `count()` de drizzle (sinon un bigint
      // Postgres remonte en `string` via postgres.js).
      totalCount: sql<number>`count(*) over()`.mapWith(Number),
    })
      .from(post)
      .innerJoin(user, eq(post.userId, user.id))
      .innerJoin(house, eq(user.houseId, house.id))
      .leftJoin(postImage, eq(postImage.postId, post.id))
      .where(where)
      // `id` en second critère : deux demandes créées à la même seconde (ou
      // un insert en masse) auraient sinon un ordre instable d'une requête
      // à l'autre, avec un risque de doublons/trous entre deux pages (cf.
      // revue).
      .orderBy(desc(post.createdAt), desc(post.id))
      .limit(POSTS_PER_PAGE)
      .offset((page - 1) * POSTS_PER_PAGE);

  const toPosts = (
    rows: Awaited<ReturnType<typeof selectPage>>,
  ): StreetPost[] =>
    rows.map(({ imageId, imageWidth, imageHeight, totalCount: _, ...row }) => ({
      ...row,
      image: imageId !== null
        ? { id: imageId, width: imageWidth!, height: imageHeight! }
        : null,
    }));

  let rows = await selectPage(Math.max(1, input.page));

  // Page demandée hors bornes (au-delà de la dernière, ou aucune demande du
  // tout) : `count(*) over()` n'apparaît sur aucune ligne puisqu'il n'y en a
  // aucune à cette page — retombe sur une requête `COUNT` dédiée pour
  // connaître le total, ramène la page dans les bornes, puis reprend la
  // bonne page. Coûte le second aller-retour que ce changement économise
  // d'ordinaire, mais seulement dans ce cas marginal (page invalide ou fil
  // vide), jamais sur le chemin nominal.
  if (rows.length === 0) {
    const [{ value: totalCount }] = await db.select({ value: count() })
      .from(post)
      .innerJoin(user, eq(post.userId, user.id))
      .innerJoin(house, eq(user.houseId, house.id))
      .where(where);

    const totalPages = Math.max(1, Math.ceil(totalCount / POSTS_PER_PAGE));
    const page = Math.min(Math.max(1, input.page), totalPages);
    if (totalCount > 0) rows = await selectPage(page);

    return { posts: toPosts(rows), totalCount, totalPages, page };
  }

  const totalCount = rows[0].totalCount;
  const totalPages = Math.max(1, Math.ceil(totalCount / POSTS_PER_PAGE));

  return {
    posts: toPosts(rows),
    totalCount,
    totalPages,
    page: Math.max(1, input.page),
  };
}

export interface PostSummary {
  id: number;
  type: PostType;
  content: string;
  authorId: number;
  streetId: number;
}

/**
 * Aperçu léger d'une demande (avec la rue de son auteur), pour donner du
 * contexte à un message privé démarré depuis un bouton sur cette demande
 * (cf. backlog messagerie privée) ou vérifier une réponse publique (cf.
 * routes/reponses.ts) — sans passer par `listStreetPosts`, pas faite pour
 * n'en récupérer qu'une seule.
 */
export async function getPostSummary(
  postId: number,
): Promise<PostSummary | null> {
  const [found] = await db.select({
    id: post.id,
    type: post.type,
    content: post.content,
    authorId: user.id,
    streetId: house.streetId,
  })
    .from(post)
    .innerJoin(user, eq(post.userId, user.id))
    .innerJoin(house, eq(user.houseId, house.id))
    .where(and(eq(post.id, postId), isNull(post.deletedAt)));
  return found ?? null;
}
