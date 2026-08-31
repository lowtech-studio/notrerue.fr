import { define, isUserVerified } from "../../../../utils.ts";
import { getStreetHousesStatus } from "../../../../db/streets.ts";
import {
  computeExpiresAt,
  createPost,
  isPostDuration,
  isPostType,
  listStreetPosts,
  MAX_POST_CONTENT_LENGTH,
  MAX_POST_DURATION_MONTHS,
  MAX_SEARCH_LENGTH,
  MIN_POST_DURATION_MONTHS,
  type PostType,
} from "../../../../db/posts.ts";
import { attachPostExtras } from "../../../../db/post_feed.ts";
import { containsBlockedContent } from "../../../../moderation/blocklist.ts";
import {
  MAX_IMAGE_UPLOAD_BYTES,
  resizeAndEncodeImage,
  UnsupportedImageError,
} from "../../../../utils/image.ts";
import { createCooldown } from "../../../../utils/rate_limit.ts";
import { notifyNewPost } from "../../../../push/expo.ts";
import { toPostDto } from "./dto.ts";

function parsePage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseType(raw: string | null): PostType | undefined {
  return raw && isPostType(raw) ? raw : undefined;
}

function parseDurationMonths(
  raw: FormDataEntryValue | null,
  fallback: number,
): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(
    Math.max(parsed, MIN_POST_DURATION_MONTHS),
    MAX_POST_DURATION_MONTHS,
  );
}

/**
 * Anti-spam sur la publication (cf. _doc/architecture-mobile.md « rate
 * limiting sur les actions sensibles ») : contrairement au web (cookie de
 * session + formulaire HTML, déjà plus coûteux à automatiser), l'API
 * mobile n'est protégée que par un jeton Bearer — un jeton volé ou un
 * client buggé ne doit pas pouvoir publier en rafale. Clé = utilisateur,
 * fenêtre courte : ne gêne aucun usage réel (une demande tient en une
 * phrase, cf. backlog), bloque juste le spam automatisé.
 */
const POST_COOLDOWN_MS = 3000;
const postCooldown = createCooldown(POST_COOLDOWN_MS);

/**
 * GET/POST /api/v1/posts — fil de la rue de l'habitant connecté et
 * publication d'une demande, pour l'app mobile (cf. backlog mobile « avoir
 * toutes les fonctionnalités de la page /fil »). Réutilise telle quelle la
 * logique de routes/fil.tsx : `listStreetPosts`/`attachPostExtras` (cf.
 * db/post_feed.ts, extrait de fil.tsx pour être partagé ici sans
 * dupliquer), `createPost`, modération, redimensionnement d'image — mêmes
 * règles, un seul endroit qui les applique.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return Response.json(
        { error: "Authentification requise." },
        { status: 401 },
      );
    }

    const streetStatus = await getStreetHousesStatus(user.street.id);
    if (!streetStatus.isAwake) {
      return Response.json({
        streetName: user.street.name,
        housesCount: streetStatus.housesCount,
        isStreetAwake: false,
        viewer: {
          id: user.id,
          login: user.login,
          isVerified: isUserVerified(user),
        },
        posts: [],
        page: 1,
        totalPages: 1,
        totalCount: 0,
      });
    }

    const type = parseType(ctx.url.searchParams.get("type"));
    const search = ctx.url.searchParams.get("q")?.trim().slice(
      0,
      MAX_SEARCH_LENGTH,
    ) || undefined;
    const page = parsePage(ctx.url.searchParams.get("page"));

    const { posts: rawPosts, totalPages, totalCount, page: resolvedPage } =
      await listStreetPosts({ streetId: user.street.id, type, search, page });
    const posts = await attachPostExtras(rawPosts, user.id);

    return Response.json({
      streetName: user.street.name,
      housesCount: streetStatus.housesCount,
      isStreetAwake: true,
      viewer: {
        id: user.id,
        login: user.login,
        isVerified: isUserVerified(user),
      },
      posts: posts.map(toPostDto),
      page: resolvedPage,
      totalPages,
      totalCount,
    });
  },

  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return Response.json(
        { error: "Authentification requise." },
        { status: 401 },
      );
    }

    const streetStatus = await getStreetHousesStatus(user.street.id);
    if (!streetStatus.isAwake) {
      return Response.json(
        { error: "Votre rue n'est pas encore allumée." },
        { status: 403 },
      );
    }
    if (!isUserVerified(user)) {
      return Response.json(
        {
          error:
            "Votre compte doit être vérifié par un voisin avant de publier.",
        },
        { status: 403 },
      );
    }
    if (postCooldown.isActive(user.id)) {
      return Response.json(
        { error: "Merci de patienter avant de publier à nouveau." },
        { status: 429 },
      );
    }

    let form: FormData;
    try {
      form = await ctx.req.formData();
    } catch {
      return Response.json(
        { error: "Corps multipart/form-data invalide." },
        { status: 400 },
      );
    }

    const rawType = String(form.get("type") ?? "");
    const rawDuration = String(form.get("duration") ?? "");
    const content = String(form.get("content") ?? "").trim().slice(
      0,
      MAX_POST_CONTENT_LENGTH,
    );
    const postDurationMonths = parseDurationMonths(
      form.get("durationMonths"),
      MIN_POST_DURATION_MONTHS,
    );

    // Même garde qu'un `<input type="file">` non rempli côté web : un champ
    // `image` absent ou vide (taille nulle) n'est pas une pièce jointe.
    const imageFile = form.get("image");
    const hasImage = imageFile instanceof File && imageFile.size > 0;
    let imageError: string | null = null;
    let image: Parameters<typeof createPost>[0]["image"];
    if (hasImage) {
      if (imageFile.size > MAX_IMAGE_UPLOAD_BYTES) {
        imageError = "L'image dépasse la taille maximale autorisée (5 Mo).";
      } else {
        try {
          const bytes = new Uint8Array(await imageFile.arrayBuffer());
          const resized = await resizeAndEncodeImage(bytes);
          image = { streetId: user.street.id, ...resized };
        } catch (cause) {
          if (!(cause instanceof UnsupportedImageError)) throw cause;
          imageError =
            "Format d'image non reconnu — essayez un JPEG, PNG ou WebP.";
        }
      }
    }

    if (!isPostType(rawType) || !isPostDuration(rawDuration) || !content) {
      return Response.json(
        {
          error:
            "Merci de choisir un type, une durée et d'écrire votre demande.",
        },
        { status: 400 },
      );
    }
    if (containsBlockedContent(content)) {
      return Response.json(
        {
          error:
            "Merci de reformuler : ce message contient des termes non autorisés.",
        },
        { status: 422 },
      );
    }
    if (imageError) {
      return Response.json({ error: imageError }, { status: 400 });
    }

    postCooldown.record(user.id);

    const expiresAt = computeExpiresAt(rawDuration, postDurationMonths);
    const created = await createPost({
      userId: user.id,
      type: rawType,
      content,
      expiresAt,
      image,
    });

    // Notifie les voisins de la rue (cf. backlog mobile « notifié... lors
    // de l'ajout d'une demande dans ma rue ») — tolérant à l'échec, la
    // demande est déjà publiée.
    try {
      await notifyNewPost({
        streetId: user.street.id,
        authorId: user.id,
        authorLogin: user.login,
        postType: rawType,
        postContent: content,
      });
    } catch (error) {
      console.error(
        "Échec de la notification push de nouvelle demande (API mobile) :",
        error,
      );
    }

    return Response.json({
      post: toPostDto({
        id: created.id,
        type: created.type,
        content: created.content,
        createdAt: created.createdAt,
        authorId: user.id,
        authorLogin: user.login,
        image: created.image,
        tapCount: 0,
        viewerHasTapped: false,
        tappers: [],
        comments: [],
      }),
    }, { status: 201 });
  },
});
