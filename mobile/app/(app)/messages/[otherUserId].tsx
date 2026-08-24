import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { AppHeader } from "../../../components/AppHeader";
import {
  fetchThread,
  sendMessage as sendPrivateMessage,
  type Thread,
  type ThreadMessage,
} from "../../../lib/api";
import { formatRelativeDate } from "../../../lib/relativeDate";
import {
  colors,
  fontDisplay,
  radius,
  type ThemeColors,
} from "../../../lib/theme";

const MAX_MESSAGE_CONTENT_LENGTH = 1000;

/**
 * Conversation avec un voisin (cf. routes/api/v1/messages/[otherUserId].ts,
 * même comportement que web/routes/messages.tsx, vue « thread ») : messages
 * alignés à gauche/droite selon l'expéditeur, contexte de demande en tête si
 * la conversation en vient (bouton « Message » sur une demande du fil, cf.
 * components/fil/PostCard.tsx), composeur en bas.
 */
export default function MessageThread() {
  const { otherUserId: otherUserIdParam, postId: postIdParam } =
    useLocalSearchParams<{ otherUserId: string; postId?: string }>();
  const otherUserId = Number(otherUserIdParam);
  const postId = postIdParam ? Number(postIdParam) : undefined;

  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];
  const styles = createStyles(palette);
  const listRef = useRef<FlatList<ThreadMessage>>(null);

  const [thread, setThread] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetchThread(otherUserId, postId).then((result) => {
      if (result.ok) {
        setThread(result.data);
      } else {
        setError(result.error);
      }
      setLoading(false);
    });
    // `otherUserId`/`postId` ne changent jamais après le premier rendu de
    // cet écran (un nouvel écran est poussé pour une autre conversation,
    // cf. router.push dans l'inbox) — tableau de dépendances vide
    // volontaire, pas un oubli.
  }, []);

  async function handleSend() {
    const trimmed = content.trim();
    if (!trimmed || !thread) return;
    setSending(true);
    setError(null);
    const result = await sendPrivateMessage(
      otherUserId,
      trimmed,
      thread.postContext?.id,
    );
    setSending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setThread((prev) =>
      prev ? { ...prev, messages: [...prev.messages, result.data.message] } : prev
    );
    setContent("");
  }

  if (loading) {
    return (
      <View style={styles.flex}>
        <AppHeader />
        <View style={styles.center}>
          <ActivityIndicator color={palette.brand} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <AppHeader />

      <Pressable
        style={styles.back}
        onPress={() => router.back()}
        accessibilityRole="button"
      >
        <Text style={styles.backText}>← Mes messages</Text>
      </Pressable>

      {thread
        ? (
          <>
            <Text style={styles.title}>{thread.otherUserLogin}</Text>
            {thread.postContext && (
              <Text style={styles.postContext}>
                À propos de : « {thread.postContext.content} »
              </Text>
            )}

            <FlatList
              ref={listRef}
              data={thread.messages}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={styles.list}
              onContentSizeChange={() =>
                listRef.current?.scrollToEnd({ animated: false })}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  Aucun message échangé pour l'instant. Écrivez le premier
                  ci-dessous.
                </Text>
              }
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.bubbleRow,
                    item.fromViewer
                      ? styles.bubbleRowMine
                      : styles.bubbleRowTheirs,
                  ]}
                >
                  <View
                    style={[
                      styles.bubble,
                      item.fromViewer
                        ? styles.bubbleMine
                        : styles.bubbleTheirs,
                    ]}
                  >
                    <Text
                      style={item.fromViewer
                        ? styles.bubbleTextMine
                        : styles.bubbleTextTheirs}
                    >
                      {item.content}
                    </Text>
                    <Text
                      style={item.fromViewer
                        ? styles.bubbleDateMine
                        : styles.bubbleDateTheirs}
                    >
                      {formatRelativeDate(new Date(item.createdAt))}
                    </Text>
                  </View>
                </View>
              )}
            />

            {error && <Text style={styles.error}>{error}</Text>}

            {thread.otherUserDeleted
              ? (
                <Text style={styles.empty}>
                  Ce compte a été supprimé, vous ne pouvez plus lui écrire.
                </Text>
              )
              : (
                <View style={styles.composer}>
                  <TextInput
                    style={styles.input}
                    value={content}
                    onChangeText={(text) =>
                      setContent(text.slice(0, MAX_MESSAGE_CONTENT_LENGTH))}
                    placeholder="Votre message…"
                    placeholderTextColor={palette.inkMuted}
                    multiline
                  />
                  <Pressable
                    style={[
                      styles.sendButton,
                      (sending || !content.trim()) && styles.sendButtonDisabled,
                    ]}
                    onPress={handleSend}
                    disabled={sending || !content.trim()}
                  >
                    {sending
                      ? <ActivityIndicator color={palette.paperWarm} />
                      : <Text style={styles.sendButtonText}>Envoyer</Text>}
                  </Pressable>
                </View>
              )}
          </>
        )
        : <Text style={styles.error}>{error}</Text>}
    </KeyboardAvoidingView>
  );
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: palette.paper },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    back: { paddingHorizontal: 20, paddingTop: 12 },
    backText: { fontSize: 13, fontWeight: "600", color: palette.inkSoft },
    title: {
      fontFamily: fontDisplay,
      fontSize: 20,
      fontWeight: "700",
      color: palette.ink,
      paddingHorizontal: 20,
      paddingTop: 8,
    },
    postContext: {
      fontSize: 13,
      color: palette.inkSoft,
      fontStyle: "italic",
      paddingHorizontal: 20,
      paddingTop: 4,
    },
    list: { paddingHorizontal: 20, paddingVertical: 12, gap: 8, flexGrow: 1 },
    empty: {
      fontSize: 14,
      color: palette.inkMuted,
      textAlign: "center",
      marginTop: 24,
      paddingHorizontal: 20,
    },
    error: {
      color: palette.danger,
      fontSize: 13,
      paddingHorizontal: 20,
      marginBottom: 6,
    },
    bubbleRow: { flexDirection: "row" },
    bubbleRowMine: { justifyContent: "flex-end" },
    bubbleRowTheirs: { justifyContent: "flex-start" },
    bubble: {
      maxWidth: "80%",
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    bubbleMine: { backgroundColor: palette.brand },
    bubbleTheirs: {
      backgroundColor: palette.paperWarm,
      borderWidth: 1,
      borderColor: palette.border,
    },
    bubbleTextMine: { color: palette.paperWarm, fontSize: 15 },
    bubbleTextTheirs: { color: palette.ink, fontSize: 15 },
    bubbleDateMine: {
      color: palette.paperWarm,
      opacity: 0.8,
      fontSize: 11,
      marginTop: 4,
    },
    bubbleDateTheirs: { color: palette.inkMuted, fontSize: 11, marginTop: 4 },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 10,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: palette.border,
    },
    input: {
      flex: 1,
      borderWidth: 2,
      borderColor: palette.borderStrong,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 15,
      color: palette.ink,
      backgroundColor: palette.paper,
      maxHeight: 100,
    },
    sendButton: {
      backgroundColor: palette.brand,
      borderRadius: radius.md,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    sendButtonDisabled: { opacity: 0.6 },
    sendButtonText: { color: palette.paperWarm, fontWeight: "700", fontSize: 14 },
  });
}
