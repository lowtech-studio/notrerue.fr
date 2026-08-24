import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { AppHeader } from "../../../components/AppHeader";
import { type Conversation, fetchConversations } from "../../../lib/api";
import { formatRelativeDate } from "../../../lib/relativeDate";
import {
  colors,
  fontDisplay,
  radius,
  type ThemeColors,
} from "../../../lib/theme";

/**
 * Boîte de réception (cf. routes/api/v1/messages/index.ts, backlog mobile
 * « toutes les fonctionnalités de la page /messages ») — une ligne par
 * interlocuteur, la plus récente d'abord, même comportement que
 * web/routes/messages.tsx. Ouvrir une conversation pousse vers l'écran
 * `[otherUserId].tsx`.
 */
export default function MessagesInbox() {
  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];
  const styles = createStyles(palette);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isStreetAwake, setIsStreetAwake] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const result = await fetchConversations();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setIsStreetAwake(result.data.isStreetAwake);
    setConversations(result.data.conversations);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <View style={styles.flex}>
      <AppHeader />

      {loading
        ? (
          <View style={styles.center}>
            <ActivityIndicator color={palette.brand} />
          </View>
        )
        : isStreetAwake === false
        ? (
          <View style={styles.center}>
            <Text style={styles.subtitle}>
              Votre rue n'est pas encore allumée : aucune conversation n'est
              possible avant que vos voisins vous rejoignent.
            </Text>
          </View>
        )
        : (
          <FlatList
            data={conversations}
            keyExtractor={(item) => String(item.otherUserId)}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={palette.brand}
              />
            }
            ListHeaderComponent={
              <View style={styles.headerBlock}>
                <Text style={styles.title}>Mes messages</Text>
                <Text style={styles.subtitle}>
                  Vos conversations privées avec vos voisins, elles ne sont
                  visibles que de vous deux.
                </Text>
                {error && <Text style={styles.error}>{error}</Text>}
              </View>
            }
            ListEmptyComponent={
              <Text style={styles.empty}>
                Aucune conversation pour l'instant. Répondez à une demande du
                fil avec le bouton « Message » pour en démarrer une.
              </Text>
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            renderItem={({ item }) => (
              <Pressable
                style={styles.row}
                onPress={() =>
                  router.push(`/(app)/messages/${item.otherUserId}`)}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {item.otherUserLogin.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.rowBody}>
                  <View style={styles.rowHeader}>
                    <Text style={styles.login}>{item.otherUserLogin}</Text>
                    <Text style={styles.date}>
                      {formatRelativeDate(new Date(item.lastMessageAt))}
                    </Text>
                  </View>
                  <Text style={styles.preview} numberOfLines={1}>
                    {item.lastMessageFromViewer ? "Vous : " : ""}
                    {item.lastMessage}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        )}
    </View>
  );
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: palette.paper },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    list: { paddingHorizontal: 20, paddingBottom: 24 },
    headerBlock: { paddingTop: 8, paddingBottom: 16 },
    title: {
      fontFamily: fontDisplay,
      fontSize: 22,
      fontWeight: "700",
      color: palette.ink,
      marginBottom: 4,
    },
    subtitle: { fontSize: 14, color: palette.inkSoft, lineHeight: 20 },
    error: { color: palette.danger, fontSize: 13, marginTop: 8 },
    empty: {
      fontSize: 14,
      color: palette.inkMuted,
      textAlign: "center",
      marginTop: 40,
    },
    separator: { height: 1, backgroundColor: palette.border },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: palette.brand,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { color: palette.paperWarm, fontWeight: "700", fontSize: 15 },
    rowBody: { flex: 1, gap: 2 },
    rowHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "baseline",
    },
    login: { fontSize: 15, fontWeight: "700", color: palette.ink },
    date: { fontSize: 12, color: palette.inkMuted },
    preview: { fontSize: 13, color: palette.inkSoft },
  });
}
