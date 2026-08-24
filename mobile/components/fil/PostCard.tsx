import { useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import {
  addComment,
  deletePost,
  type Post,
  type PostType,
  toggleTap,
  updatePost,
} from "../../lib/api";
import { formatRelativeDate } from "../../lib/relativeDate";
import { colors, radius, type ThemeColors } from "../../lib/theme";
import { PostImage } from "./PostImage";

const POST_TYPE_LABELS: Record<PostType, string> = {
  cherche: "Je cherche",
  propose: "Je propose",
  informe: "J'informe",
};

/** Libellé du bouton de réponse en un tap, selon le type (cf.
 * db/posts.ts#TAP_LABELS côté web — dupliqué ici, constante pure, cf.
 * lib/relativeDate.ts pour le même raisonnement sur la frontière
 * Deno/Metro). */
const TAP_LABELS: Record<PostType, string> = {
  cherche: "J'ai",
  propose: "Intéressé",
  informe: "👍",
};

/** Au-delà, les noms débordant sont repliés derrière « +N » plutôt que de
 * faire déborder la carte (même seuil que web/routes/fil.tsx). */
const TAPPERS_VISIBLE_LIMIT = 6;
const MAX_COMMENT_CONTENT_LENGTH = 280;

interface PostCardProps {
  post: Post;
  viewerId: number;
  isVerified: boolean;
  onChanged: (post: Post) => void;
  onDeleted: (postId: number) => void;
}

/**
 * Une demande du fil — badge, contenu, photo éventuelle, réponse en un tap,
 * réponses publiques, et (sur ses propres demandes) qui a tapé, correction
 * et suppression. Mêmes règles que web/routes/fil.tsx, portées en RN.
 */
export function PostCard(
  { post, viewerId, isVerified, onChanged, onDeleted }: PostCardProps,
) {
  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];
  const styles = createStyles(palette);
  const isOwn = post.authorId === viewerId;

  const [tapping, setTapping] = useState(false);
  const [tappersExpanded, setTappersExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  async function handleTap() {
    setTapping(true);
    const result = await toggleTap(post.id);
    setTapping(false);
    if (!result.ok) return;
    onChanged({
      ...post,
      viewerHasTapped: result.data.tapped,
      tapCount: result.data.tapCount,
    });
  }

  async function handleSaveEdit() {
    const trimmed = editContent.trim();
    if (!trimmed) {
      setEditError("Le contenu ne peut pas être vide.");
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    const result = await updatePost(post.id, trimmed);
    setEditSubmitting(false);
    if (!result.ok) {
      setEditError(result.error);
      return;
    }
    onChanged({ ...post, content: result.data.content });
    setEditing(false);
  }

  async function handleDelete() {
    setDeleting(true);
    const result = await deletePost(post.id);
    setDeleting(false);
    if (result.ok) onDeleted(post.id);
  }

  async function handleAddComment() {
    const trimmed = commentText.trim();
    if (!trimmed) return;
    setCommentSubmitting(true);
    setCommentError(null);
    const result = await addComment(post.id, trimmed);
    setCommentSubmitting(false);
    if (!result.ok) {
      setCommentError(result.error);
      return;
    }
    onChanged({ ...post, comments: [...post.comments, result.data.comment] });
    setCommentText("");
  }

  const visibleTappers = tappersExpanded
    ? post.tappers
    : post.tappers.slice(0, TAPPERS_VISIBLE_LIMIT);
  const hiddenTappersCount = post.tappers.length - visibleTappers.length;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.badge}>{POST_TYPE_LABELS[post.type]}</Text>
        {isOwn && (
          <View style={styles.ownActions}>
            <Pressable onPress={() => setEditing((v) => !v)}>
              <Text style={styles.ownActionText}>
                {editing ? "Annuler" : "Modifier"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                confirmingDelete ? handleDelete() : setConfirmingDelete(true)}
              disabled={deleting}
            >
              {deleting
                ? <ActivityIndicator size="small" color={palette.danger} />
                : (
                  <Text style={[styles.ownActionText, styles.dangerText]}>
                    {confirmingDelete ? "Confirmer ?" : "Supprimer"}
                  </Text>
                )}
            </Pressable>
          </View>
        )}
      </View>

      {editing
        ? (
          <View style={styles.editBlock}>
            <TextInput
              style={styles.editInput}
              value={editContent}
              onChangeText={setEditContent}
              multiline
              maxLength={240}
            />
            {editError && <Text style={styles.error}>{editError}</Text>}
            <Pressable
              style={[styles.saveButton, editSubmitting && styles.disabled]}
              onPress={handleSaveEdit}
              disabled={editSubmitting}
            >
              {editSubmitting
                ? <ActivityIndicator color={palette.paperWarm} />
                : <Text style={styles.saveButtonText}>Enregistrer</Text>}
            </Pressable>
          </View>
        )
        : <Text style={styles.content}>{post.content}</Text>}

      {post.image && (
        <PostImage
          imageId={post.image.id}
          width={post.image.width}
          height={post.image.height}
        />
      )}

      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {post.authorLogin} · {formatRelativeDate(new Date(post.createdAt))}
        </Text>
        {!isOwn && (
          <Pressable
            style={styles.messageButton}
            onPress={() =>
              router.push(
                `/(app)/messages/${post.authorId}?postId=${post.id}`,
              )}
          >
            <Text style={styles.messageButtonText}>Message</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.actionsRow}>
        {!isOwn && isVerified && (
          <Pressable
            style={[
              styles.tapButton,
              post.viewerHasTapped && styles.tapButtonActive,
            ]}
            onPress={handleTap}
            disabled={tapping}
          >
            <Text
              style={[
                styles.tapButtonText,
                post.viewerHasTapped && styles.tapButtonTextActive,
              ]}
            >
              {TAP_LABELS[post.type]}
            </Text>
          </Pressable>
        )}
        {post.tapCount > 0 && (
          <Text style={styles.tapCount}>
            {post.tapCount} {post.tapCount > 1 ? "réponses" : "réponse"}
          </Text>
        )}
      </View>

      {isOwn && post.tappers.length > 0 && (
        <View style={styles.tappersBlock}>
          <Text style={styles.tappersText}>
            A tapé : {visibleTappers.map((t) => t.login).join(", ")}
            {hiddenTappersCount > 0 && !tappersExpanded && (
              <Text
                style={styles.tappersMore}
                onPress={() => setTappersExpanded(true)}
              >
                {" "}+{hiddenTappersCount}
              </Text>
            )}
          </Text>
        </View>
      )}

      {post.comments.length > 0 && (
        <View style={styles.commentsBlock}>
          {post.comments.map((c) => (
            <View key={c.id} style={styles.comment}>
              <Text style={styles.commentAuthor}>{c.authorLogin}</Text>
              <Text style={styles.commentContent}>{c.content}</Text>
            </View>
          ))}
        </View>
      )}

      {isVerified && (
        <View style={styles.commentComposer}>
          <TextInput
            style={styles.commentInput}
            value={commentText}
            onChangeText={(text) =>
              setCommentText(text.slice(0, MAX_COMMENT_CONTENT_LENGTH))}
            placeholder="Répondre publiquement…"
            placeholderTextColor={palette.inkMuted}
          />
          <Pressable
            onPress={handleAddComment}
            disabled={commentSubmitting || !commentText.trim()}
          >
            {commentSubmitting
              ? <ActivityIndicator size="small" color={palette.brand} />
              : <Text style={styles.commentSubmit}>Envoyer</Text>}
          </Pressable>
        </View>
      )}
      {commentError && <Text style={styles.error}>{commentError}</Text>}
    </View>
  );
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radius.md,
      padding: 14,
      backgroundColor: palette.paperWarm,
      gap: 6,
    },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    badge: {
      fontSize: 11,
      fontWeight: "700",
      color: palette.brand,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    ownActions: { flexDirection: "row", gap: 12 },
    ownActionText: { fontSize: 12, fontWeight: "600", color: palette.inkSoft },
    dangerText: { color: palette.danger },
    content: { fontSize: 15, color: palette.ink, lineHeight: 21 },
    editBlock: { gap: 6 },
    editInput: {
      borderWidth: 2,
      borderColor: palette.borderStrong,
      borderRadius: radius.md,
      padding: 10,
      fontSize: 15,
      color: palette.ink,
      backgroundColor: palette.paper,
      minHeight: 60,
      textAlignVertical: "top",
    },
    saveButton: {
      backgroundColor: palette.brand,
      borderRadius: radius.md,
      paddingVertical: 8,
      alignItems: "center",
    },
    saveButtonText: { color: palette.paperWarm, fontWeight: "700", fontSize: 13 },
    disabled: { opacity: 0.6 },
    metaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    meta: { fontSize: 12, color: palette.inkMuted },
    // Pas d'émoji ✉️ ici (cf. retour utilisateur « couleur peu visible ») :
    // un émoji garde sa propre couleur embarquée quel que soit le style de
    // texte appliqué autour (rendu clair/atténué selon la police d'émojis
    // du système) — un fond/bordure pleinement maîtrisés, comme le bouton
    // de tap, ne dépendent pas de ça.
    messageButton: {
      borderWidth: 2,
      borderColor: palette.brand,
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    messageButtonText: { fontSize: 12, fontWeight: "700", color: palette.brand },
    actionsRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    tapButton: {
      borderWidth: 2,
      borderColor: palette.borderStrong,
      borderRadius: radius.lg,
      paddingHorizontal: 14,
      paddingVertical: 6,
    },
    tapButtonActive: { backgroundColor: palette.brand, borderColor: palette.brand },
    tapButtonText: { fontSize: 13, fontWeight: "700", color: palette.inkSoft },
    tapButtonTextActive: { color: palette.paperWarm },
    tapCount: { fontSize: 12, color: palette.inkMuted },
    tappersBlock: { marginTop: 2 },
    tappersText: { fontSize: 12, color: palette.inkSoft },
    tappersMore: { color: palette.brand, fontWeight: "700" },
    commentsBlock: { gap: 6, marginTop: 4 },
    comment: {
      borderLeftWidth: 2,
      borderLeftColor: palette.border,
      paddingLeft: 8,
    },
    commentAuthor: { fontSize: 12, fontWeight: "700", color: palette.inkSoft },
    commentContent: { fontSize: 13, color: palette.ink },
    commentComposer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 4,
    },
    commentInput: {
      flex: 1,
      borderWidth: 2,
      borderColor: palette.borderStrong,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 13,
      color: palette.ink,
      backgroundColor: palette.paper,
    },
    commentSubmit: { fontSize: 13, fontWeight: "700", color: palette.brand },
    error: { color: palette.danger, fontSize: 12, marginTop: 4 },
  });
}
