import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  useColorScheme,
  View,
} from "react-native";
import { authFetch } from "../../lib/api";
import { colors, radius } from "../../lib/theme";

interface PostImageProps {
  imageId: number;
  width: number;
  height: number;
}

/**
 * Photo jointe à une demande — `/photos/:id` (cf. routes/photos/[id].ts)
 * exige un habitant connecté de la même rue, jamais servie en clair.
 *
 * Ne passe pas par `<Image source={{ uri, headers }} />` (l'approche RN
 * habituelle pour une image authentifiée) : ça ne fonctionne pas sur la
 * cible web (`react-native-web` rend un `<img>` HTML brut, qui ne peut pas
 * porter d'en-têtes personnalisés — la requête part sans jeton, 404 côté
 * serveur, image invisible en silence, cf. constat terrain). On récupère
 * donc les octets nous-mêmes via `authFetch` (jeton en en-tête, chemin déjà
 * authentifié) puis on les ré-expose en `data:` URI — universel sur les
 * trois cibles (iOS, Android, web).
 */
export function PostImage({ imageId, width, height }: PostImageProps) {
  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUri(null);
    setFailed(false);

    (async () => {
      try {
        const res = await authFetch(`/photos/${imageId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const dataUri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        if (!cancelled) setUri(dataUri);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [imageId]);

  const aspectRatio = width / height;

  if (failed) return null;

  if (!uri) {
    return (
      <View style={[styles.placeholder, { aspectRatio }]}>
        <ActivityIndicator color={palette.brand} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[styles.image, { aspectRatio }]}
      resizeMode="cover"
      accessibilityLabel="Photo jointe à la demande"
    />
  );
}

const styles = StyleSheet.create({
  image: {
    width: "100%",
    borderRadius: radius.md,
    marginTop: 8,
    backgroundColor: "#0000000d",
  },
  placeholder: {
    width: "100%",
    borderRadius: radius.md,
    marginTop: 8,
    backgroundColor: "#0000000d",
    alignItems: "center",
    justifyContent: "center",
  },
});
