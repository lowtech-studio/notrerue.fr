import { define } from "../../../../utils.ts";
import {
  getPostSummary,
  MAX_POST_CONTENT_LENGTH,
  softDeletePost,
  updatePostContent,
} from "../../../../db/posts.ts";
import { containsBlockedContent } from "../../../../moderation/blocklist.ts";

function parsePostId(raw: string | undefined): number | null {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * PATCH/DELETE /api/v1/posts/:id — corriger ou supprimer une de ses propres
 * demandes (cf. routes/modifier.ts et routes/supprimer.ts, mêmes règles :
 * seul le contenu se corrige, pas le type ni la durée ; suppression douce).
 */
export const handler = define.handlers({
  async PATCH(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return Response.json(
        { error: "Authentification requise." },
        { status: 401 },
      );
    }

    const postId = parsePostId(ctx.params.id);
    if (!postId) {
      return Response.json({ error: "Identifiant invalide." }, {
        status: 400,
      });
    }

    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return Response.json(
        { error: "Corps JSON invalide." },
        { status: 400 },
      );
    }
    const content = String(
      (body as Record<string, unknown> | null)?.content ?? "",
    )
      .trim().slice(0, MAX_POST_CONTENT_LENGTH);
    if (!content) {
      return Response.json(
        { error: "Le contenu ne peut pas être vide." },
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

    // Revalidé en base plutôt que de faire confiance au client : un postId
    // forgé ne doit rien modifier chez un autre habitant (même précaution
    // que routes/modifier.ts).
    const summary = await getPostSummary(postId);
    if (!summary || summary.authorId !== user.id) {
      return Response.json({ error: "Demande introuvable." }, {
        status: 404,
      });
    }

    const updated = await updatePostContent(postId, user.id, content);
    return Response.json({ ok: true, content: updated?.content ?? content });
  },

  async DELETE(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return Response.json(
        { error: "Authentification requise." },
        { status: 401 },
      );
    }

    const postId = parsePostId(ctx.params.id);
    if (!postId) {
      return Response.json({ error: "Identifiant invalide." }, {
        status: 400,
      });
    }

    const summary = await getPostSummary(postId);
    if (!summary || summary.authorId !== user.id) {
      return Response.json({ error: "Demande introuvable." }, {
        status: 404,
      });
    }

    await softDeletePost(postId, user.id);
    return Response.json({ ok: true });
  },
});
