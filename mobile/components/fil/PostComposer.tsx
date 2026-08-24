import { useState } from "react";
import * as ImagePicker from "expo-image-picker";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import {
  createPost,
  type PickedImage,
  type Post,
  type PostDuration,
  type PostType,
} from "../../lib/api";
import { colors, fontDisplay, radius, type ThemeColors } from "../../lib/theme";

const MAX_POST_CONTENT_LENGTH = 240;

/** Au verbe plutôt qu'à la première personne (cf. web/routes/fil.tsx :
 * "Je souhaite" est déjà porté par le libellé au-dessus, un "Je cherche"
 * ici ferait doublon — même raisonnement, même choix côté mobile). */
const COMPOSE_TYPE_LABELS: Record<PostType, string> = {
  cherche: "Chercher",
  propose: "Proposer",
  informe: "Informer",
};

/** Même exemple qu'en web (cf. routes/fil.tsx#POST_CONTENT_PLACEHOLDERS) —
 * "cherche" porte aussi un exemple de recommandation, l'ancien type dédié
 * ayant été fusionné dedans. */
const CONTENT_PLACEHOLDERS: Record<PostType, string> = {
  cherche:
    "Une phrase, c'est tout : « Je cherche une perceuse ce week-end » ou « Un plombier fiable pour une fuite ? »",
  propose: "Une phrase, c'est tout : « Je prête ma tondeuse ce week-end »",
  informe: "Une phrase, c'est tout : « Coupure d'eau prévue mardi matin »",
};

const DURATION_LABELS: Record<"today" | "week", string> = {
  today: "Aujourd'hui",
  week: "Cette semaine",
};
const DURATION_MONTHS_OPTIONS = [1, 2, 3, 4, 5, 6];

interface PostComposerProps {
  onPublished: (post: Post) => void;
}

/**
 * Formulaire de publication — mêmes champs et mêmes règles que
 * web/routes/fil.tsx (type, durée, photo facultative) en moins de 30
 * secondes (cf. backlog). La modération/validation définitive reste
 * côté serveur (cf. mobile/AGENTS.md « pas de logique métier dupliquée ») :
 * ce formulaire ne fait qu'afficher l'erreur renvoyée, jamais ses propres
 * règles de blocage.
 */
export function PostComposer({ onPublished }: PostComposerProps) {
  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];
  const styles = createStyles(palette);

  const [type, setType] = useState<PostType>("cherche");
  const [content, setContent] = useState("");
  const [duration, setDuration] = useState<PostDuration>("week");
  const [durationMonths, setDurationMonths] = useState(1);
  const [image, setImage] = useState<PickedImage | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickImage(fromCamera: boolean) {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Autorisation refusée",
        fromCamera
          ? "Autorisez l'accès à l'appareil photo dans les réglages pour joindre une photo."
          : "Autorisez l'accès aux photos dans les réglages pour joindre une photo.",
      );
      return;
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });
    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0];
    setImage({
      uri: asset.uri,
      // Redimensionnement/compression définitifs faits côté serveur (cf.
      // utils/image.ts) : nom/type ici ne servent qu'à construire un
      // multipart valide, pas à préjuger du format final stocké.
      name: asset.fileName ?? "photo.jpg",
      mimeType: asset.mimeType ?? "image/jpeg",
    });
  }

  async function handleSubmit() {
    setError(null);
    const trimmed = content.trim();
    if (!trimmed) {
      setError("Merci d'écrire votre demande.");
      return;
    }

    setSubmitting(true);
    const result = await createPost({
      type,
      content: trimmed,
      duration,
      durationMonths: duration === "months" ? durationMonths : undefined,
      image,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Garde-fou : une photo choisie mais absente de la demande publiée ne
    // doit jamais passer inaperçu (cf. retour utilisateur, plutôt que de
    // se fier au silence — le serveur ne renvoie jamais d'erreur pour une
    // photo simplement absente, cf. routes/api/v1/posts/index.ts). Une
    // `Alert` plutôt que le message d'erreur du formulaire : `onPublished`
    // ci-dessous referme aussitôt cette fenêtre côté écran appelant, un
    // texte affiché ici ne serait jamais lu.
    if (image && !result.data.post.image) {
      Alert.alert(
        "Photo non jointe",
        "La demande est publiée, mais la photo n'a pas pu être jointe — réessayez de l'ajouter en modifiant la demande.",
      );
    }
    onPublished(result.data.post);
    setContent("");
    setImage(null);
    setDuration("week");
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Je souhaite</Text>
      <View style={styles.typeRow}>
        {(Object.keys(COMPOSE_TYPE_LABELS) as PostType[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.chip, type === t && styles.chipActive]}
            onPress={() => setType(t)}
          >
            <Text
              style={[styles.chipText, type === t && styles.chipTextActive]}
            >
              {COMPOSE_TYPE_LABELS[t]}
            </Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        style={styles.input}
        value={content}
        onChangeText={(text) => setContent(text.slice(0, MAX_POST_CONTENT_LENGTH))}
        placeholder={CONTENT_PLACEHOLDERS[type]}
        placeholderTextColor={palette.inkMuted}
        multiline
        numberOfLines={3}
      />
      <Text style={styles.counter}>
        {content.length}/{MAX_POST_CONTENT_LENGTH}
      </Text>

      <Text style={styles.label}>Durée de validité</Text>
      <View style={styles.typeRow}>
        {(["today", "week"] as const).map((d) => (
          <Pressable
            key={d}
            style={[styles.chip, duration === d && styles.chipActive]}
            onPress={() => setDuration(d)}
          >
            <Text
              style={[styles.chipText, duration === d && styles.chipTextActive]}
            >
              {DURATION_LABELS[d]}
            </Text>
          </Pressable>
        ))}
        <Pressable
          style={[styles.chip, duration === "months" && styles.chipActive]}
          onPress={() => setDuration("months")}
        >
          <Text
            style={[
              styles.chipText,
              duration === "months" && styles.chipTextActive,
            ]}
          >
            X mois
          </Text>
        </Pressable>
      </View>
      {duration === "months" && (
        <View style={styles.typeRow}>
          {DURATION_MONTHS_OPTIONS.map((months) => (
            <Pressable
              key={months}
              style={[
                styles.monthChip,
                durationMonths === months && styles.chipActive,
              ]}
              onPress={() => setDurationMonths(months)}
            >
              <Text
                style={[
                  styles.chipText,
                  durationMonths === months && styles.chipTextActive,
                ]}
              >
                {months}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {image
        ? (
          <View style={styles.imagePreviewRow}>
            <Image source={{ uri: image.uri }} style={styles.imagePreview} />
            <Pressable onPress={() => setImage(null)}>
              <Text style={styles.removeImage}>Retirer la photo</Text>
            </Pressable>
          </View>
        )
        : (
          <View style={styles.typeRow}>
            <Pressable style={styles.photoButton} onPress={() => pickImage(false)}>
              <Text style={styles.photoButtonText}>📷 Galerie</Text>
            </Pressable>
            <Pressable style={styles.photoButton} onPress={() => pickImage(true)}>
              <Text style={styles.photoButtonText}>📸 Appareil photo</Text>
            </Pressable>
          </View>
        )}

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.button, submitting && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting
          ? <ActivityIndicator color={palette.paperWarm} />
          : <Text style={styles.buttonText}>Publier</Text>}
      </Pressable>
    </View>
  );
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radius.md,
      padding: 16,
      backgroundColor: palette.paperWarm,
      marginBottom: 16,
      gap: 4,
    },
    label: {
      fontSize: 13,
      fontWeight: "600",
      color: palette.inkSoft,
      marginTop: 10,
      marginBottom: 6,
    },
    typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
      borderWidth: 2,
      borderColor: palette.borderStrong,
      borderRadius: radius.lg,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    monthChip: {
      borderWidth: 2,
      borderColor: palette.borderStrong,
      borderRadius: radius.lg,
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    chipActive: { backgroundColor: palette.brand, borderColor: palette.brand },
    chipText: { fontSize: 14, fontWeight: "600", color: palette.inkSoft },
    chipTextActive: { color: palette.paperWarm },
    input: {
      borderWidth: 2,
      borderColor: palette.borderStrong,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 15,
      color: palette.ink,
      backgroundColor: palette.paper,
      marginTop: 4,
      minHeight: 72,
      textAlignVertical: "top",
    },
    counter: {
      fontSize: 12,
      color: palette.inkMuted,
      textAlign: "right",
      marginTop: 2,
    },
    imagePreviewRow: { marginTop: 10, gap: 6 },
    imagePreview: {
      width: "100%",
      aspectRatio: 4 / 3,
      borderRadius: radius.md,
    },
    removeImage: { color: palette.danger, fontSize: 13, fontWeight: "600" },
    photoButton: {
      borderWidth: 2,
      borderColor: palette.borderStrong,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    photoButtonText: { fontSize: 13, color: palette.inkSoft, fontWeight: "600" },
    error: { color: palette.danger, fontSize: 13, marginTop: 10 },
    button: {
      backgroundColor: palette.brand,
      borderRadius: radius.md,
      paddingVertical: 12,
      alignItems: "center",
      marginTop: 14,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: palette.paperWarm, fontSize: 15, fontWeight: "700" },
  });
}
