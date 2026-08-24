import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { AppHeader } from "../../components/AppHeader";
import { PostCard } from "../../components/fil/PostCard";
import { PostComposer } from "../../components/fil/PostComposer";
import { fetchPosts, type Post, type PostType } from "../../lib/api";
import { colors, fontDisplay, radius, type ThemeColors } from "../../lib/theme";

const FILTER_TABS: { type: PostType | null; label: string }[] = [
  { type: null, label: "Tout" },
  { type: "cherche", label: "Je cherche" },
  { type: "propose", label: "Je propose" },
  { type: "informe", label: "J'informe" },
];

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Fil de la rue (cf. routes/api/v1/posts/*, backlog mobile « toutes les
 * fonctionnalités de la page /fil ») : publier, filtrer par type,
 * rechercher, répondre en un tap, répondre publiquement, corriger/supprimer
 * ses propres demandes — mêmes règles que web/routes/fil.tsx, portées en
 * composants RN (cf. components/fil/). Seule différence assumée : pas de
 * pagination par numéros de page comme le web, un simple « charger plus »
 * au défilement (plus naturel sur mobile).
 */
export default function Fil() {
  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];
  const styles = createStyles(palette);

  const [activeType, setActiveType] = useState<PostType | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [streetName, setStreetName] = useState<string | null>(null);
  const [housesCount, setHousesCount] = useState(0);
  const [isStreetAwake, setIsStreetAwake] = useState<boolean | null>(null);
  const [viewer, setViewer] = useState<
    { id: number; isVerified: boolean } | null
  >(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Le formulaire complet (type/durée/photo) prend trop de place pour
  // rester ouvert en permanence en tête du fil sur un petit écran (cf.
  // retour utilisateur) : replié derrière un bouton, ouvert en plein écran
  // au besoin — mêmes champs, juste pas la place qu'ils occupent tout le
  // temps.
  const [composerOpen, setComposerOpen] = useState(false);

  const load = useCallback(
    async (
      opts: {
        type: PostType | null;
        search: string;
        page: number;
        append?: boolean;
      },
    ) => {
      setError(null);
      const result = await fetchPosts({
        type: opts.type ?? undefined,
        q: opts.search || undefined,
        page: opts.page,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStreetName(result.data.streetName);
      setHousesCount(result.data.housesCount);
      setIsStreetAwake(result.data.isStreetAwake);
      setViewer(result.data.viewer);
      setPage(result.data.page);
      setTotalPages(result.data.totalPages);
      setPosts((prev) =>
        opts.append ? [...prev, ...result.data.posts] : result.data.posts
      );
    },
    [],
  );

  // Filtre ou recherche modifiés : on repart de la première page.
  useEffect(() => {
    setLoading(true);
    load({ type: activeType, search, page: 1 }).finally(() =>
      setLoading(false)
    );
  }, [activeType, search, load]);

  useEffect(() => {
    const timeout = setTimeout(
      () => setSearch(searchInput.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timeout);
  }, [searchInput]);

  async function handleRefresh() {
    setRefreshing(true);
    await load({ type: activeType, search, page: 1 });
    setRefreshing(false);
  }

  async function handleLoadMore() {
    if (loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    await load({ type: activeType, search, page: page + 1, append: true });
    setLoadingMore(false);
  }

  function handlePostChanged(updated: Post) {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  function handlePostDeleted(postId: number) {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }

  function handlePublished(newPost: Post) {
    // Sur sa propre page (première page, sans filtre actif ni recherche) :
    // sinon la demande fraîchement publiée disparaîtrait d'un filtre/d'une
    // recherche qui ne la concerne pas.
    setPosts((prev) => [newPost, ...prev]);
    setComposerOpen(false);
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
    <View style={styles.flex}>
      <AppHeader />

      {error && <Text style={styles.error}>{error}</Text>}

      {isStreetAwake === false
        ? (
          <View style={styles.center}>
            <Text style={styles.subtitle}>
              Votre rue n'est pas encore allumée : invitez vos voisins pour
              atteindre le seuil et débloquer le fil.
            </Text>
          </View>
        )
        : (
          <FlatList
            data={posts}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={palette.brand}
              />
            }
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.4}
            ListHeaderComponent={
              <View style={styles.headerBlock}>
                <Text style={styles.title}>Le fil de ma rue</Text>
                {streetName && (
                  <Text style={styles.streetInfo}>
                    {streetName} · {housesCount}{" "}
                    {housesCount > 1 ? "foyers" : "foyer"}
                  </Text>
                )}

                <TextInput
                  style={styles.search}
                  value={searchInput}
                  onChangeText={setSearchInput}
                  placeholder="Rechercher dans le fil…"
                  placeholderTextColor={palette.inkMuted}
                />

                <View style={styles.tabs}>
                  {FILTER_TABS.map((tab) => (
                    <Pressable
                      key={tab.label}
                      style={[
                        styles.tab,
                        activeType === tab.type && styles.tabActive,
                      ]}
                      onPress={() => setActiveType(tab.type)}
                    >
                      <Text
                        style={[
                          styles.tabText,
                          activeType === tab.type && styles.tabTextActive,
                        ]}
                      >
                        {tab.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {viewer?.isVerified === false && (
                  <Text style={styles.verifyNotice}>
                    Votre compte doit être vérifié par un voisin avant de
                    publier, répondre ou tapper.
                  </Text>
                )}
                {viewer?.isVerified && (
                  <Pressable
                    style={styles.composeButton}
                    onPress={() => setComposerOpen(true)}
                  >
                    <Text style={styles.composeButtonText}>
                      + Publier une demande
                    </Text>
                  </Pressable>
                )}
              </View>
            }
            ListEmptyComponent={
              <Text style={styles.empty}>
                Aucune demande pour l'instant.
              </Text>
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            renderItem={({ item }) =>
              viewer && (
                <PostCard
                  post={item}
                  viewerId={viewer.id}
                  isVerified={viewer.isVerified}
                  onChanged={handlePostChanged}
                  onDeleted={handlePostDeleted}
                />
              )}
            ListFooterComponent={loadingMore
              ? (
                <ActivityIndicator
                  color={palette.brand}
                  style={styles.footerLoader}
                />
              )
              : null}
          />
        )}

      <Modal
        visible={composerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setComposerOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalFlex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Nouvelle demande</Text>
            <Pressable onPress={() => setComposerOpen(false)}>
              <Text style={styles.modalClose}>Fermer</Text>
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            <PostComposer onPublished={handlePublished} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
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
    headerBlock: { paddingTop: 8, paddingBottom: 4 },
    title: {
      fontFamily: fontDisplay,
      fontSize: 22,
      fontWeight: "700",
      color: palette.ink,
    },
    streetInfo: {
      fontSize: 13,
      fontWeight: "600",
      color: palette.inkSoft,
      marginTop: 2,
      marginBottom: 12,
    },
    subtitle: {
      fontSize: 15,
      color: palette.inkSoft,
      textAlign: "center",
    },
    search: {
      borderWidth: 2,
      borderColor: palette.borderStrong,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 8,
      fontSize: 14,
      color: palette.ink,
      backgroundColor: palette.paper,
      marginBottom: 10,
    },
    tabs: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 12,
    },
    tab: {
      borderWidth: 2,
      borderColor: palette.borderStrong,
      borderRadius: radius.lg,
      paddingHorizontal: 14,
      paddingVertical: 6,
    },
    tabActive: { backgroundColor: palette.brand, borderColor: palette.brand },
    tabText: { fontSize: 13, fontWeight: "600", color: palette.inkSoft },
    tabTextActive: { color: palette.paperWarm },
    verifyNotice: {
      fontSize: 13,
      color: palette.inkSoft,
      backgroundColor: palette.paper,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radius.md,
      padding: 10,
      marginBottom: 16,
    },
    error: {
      color: palette.danger,
      marginHorizontal: 20,
      marginBottom: 8,
      fontSize: 14,
    },
    empty: {
      fontSize: 14,
      color: palette.inkMuted,
      textAlign: "center",
      marginTop: 40,
    },
    separator: { height: 12 },
    footerLoader: { marginVertical: 16 },
    composeButton: {
      backgroundColor: palette.brand,
      borderRadius: radius.md,
      paddingVertical: 12,
      alignItems: "center",
      marginBottom: 16,
    },
    composeButtonText: {
      color: palette.paperWarm,
      fontSize: 15,
      fontWeight: "700",
    },
    modalFlex: { flex: 1, backgroundColor: palette.paper },
    modalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
    },
    modalTitle: {
      fontFamily: fontDisplay,
      fontSize: 18,
      fontWeight: "700",
      color: palette.ink,
    },
    modalClose: { fontSize: 14, fontWeight: "600", color: palette.inkSoft },
    modalContent: { padding: 20 },
  });
}
