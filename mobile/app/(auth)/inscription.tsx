import { useEffect, useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import {
  type City,
  join,
  searchCities,
  searchStreets,
  type Street,
} from "../../lib/api";
import { colors, fontDisplay, radius, type ThemeColors } from "../../lib/theme";

const AGE_CONSENT_TEXT =
  "Je confirme avoir plus de 15 ans (seuil légal du consentement numérique en France).";
const CITY_SEARCH_DEBOUNCE_MS = 300;

/**
 * Inscription mobile — cf. routes/api/v1/join.ts (backend), lui-même
 * réutilisant web/routes/rejoindre.tsx. Ville et rue recherchées en direct
 * sur /api/villes et /api/rues (mêmes endpoints que
 * web/islands/RegistrationAddressFields.tsx, même UX de recherche) ; la rue
 * reste un champ texte libre au final (si elle n'existe pas encore pour la
 * ville choisie, `findOrCreateStreet` la crée à la volée côté serveur), la
 * recherche ne fait que suggérer.
 */
export default function Inscription() {
  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];
  const styles = createStyles(palette);

  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [houseNumber, setHouseNumber] = useState("");
  const [streetName, setStreetName] = useState("");
  const [streetResults, setStreetResults] = useState<Street[]>([]);
  const [streetSelected, setStreetSelected] = useState(false);
  const [cityQuery, setCityQuery] = useState("");
  const [cityResults, setCityResults] = useState<City[]>([]);
  const [selectedCity, setSelectedCity] = useState<City | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Une ville vient d'être choisie (le champ affiche son nom) : pas de
    // nouvelle recherche tant que l'habitant ne retape pas dedans.
    if (selectedCity && cityQuery === selectedCity.name) return;
    const timeout = setTimeout(() => {
      searchCities(cityQuery).then(setCityResults);
    }, CITY_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [cityQuery, selectedCity]);

  useEffect(() => {
    // Une rue vient d'être choisie (le champ affiche son nom) : pas de
    // nouvelle recherche tant que l'habitant ne retape pas dedans. Pas de
    // ville sélectionnée : pas de recherche possible, `/api/rues` exige un
    // `cityId`.
    if (streetSelected || !selectedCity) {
      setStreetResults([]);
      return;
    }
    const timeout = setTimeout(() => {
      searchStreets(streetName, selectedCity.id).then(setStreetResults);
    }, CITY_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [streetName, streetSelected, selectedCity]);

  async function handleSubmit() {
    setError(null);
    if (!login.trim() || !email.trim().includes("@") || !streetName.trim()) {
      setError("Merci de renseigner un login, un e-mail valide et une rue.");
      return;
    }
    if (!selectedCity) {
      setError("Choisissez votre ville dans la liste proposée.");
      return;
    }
    if (!ageConfirmed) {
      setError(
        "Merci de confirmer avoir plus de 15 ans pour vous inscrire.",
      );
      return;
    }

    setSubmitting(true);
    const trimmedEmail = email.trim();
    const result = await join({
      login: login.trim(),
      email: trimmedEmail,
      houseNumber: houseNumber.trim() || null,
      street: streetName.trim(),
      cityId: selectedCity.id,
      ageConfirmed,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push({
      pathname: "/(auth)/code",
      params: { email: trimmedEmail },
    });
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Rejoindre NotreRue.fr</Text>
        <Text style={styles.subtitle}>
          Un espace privé pour s'entraider entre voisins.
        </Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.label}>Login</Text>
        <TextInput
          style={styles.input}
          value={login}
          onChangeText={setLogin}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Camille"
          placeholderTextColor={palette.inkMuted}
        />

        <Text style={styles.label}>E-mail</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="camille@exemple.fr"
          placeholderTextColor={palette.inkMuted}
        />

        <Text style={styles.label}>Ville</Text>
        <TextInput
          style={styles.input}
          value={cityQuery}
          onChangeText={(text) => {
            setCityQuery(text);
            setSelectedCity(null);
            // La rue déjà choisie n'a pas forcément de sens pour la
            // nouvelle ville : on rouvre la recherche.
            setStreetSelected(false);
          }}
          placeholder="Nantes"
          placeholderTextColor={palette.inkMuted}
        />
        {cityResults.length > 0 && !selectedCity && (
          <View style={styles.suggestions}>
            <FlatList
              data={cityResults}
              keyExtractor={(item) => String(item.id)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  style={styles.suggestionRow}
                  onPress={() => {
                    setSelectedCity(item);
                    setCityQuery(item.name);
                    setCityResults([]);
                  }}
                >
                  <Text style={styles.suggestionText}>
                    {item.name} ({item.department})
                  </Text>
                </Pressable>
              )}
            />
          </View>
        )}

        <Text style={styles.label}>Rue</Text>
        <TextInput
          style={styles.input}
          value={streetName}
          onChangeText={(text) => {
            setStreetName(text);
            setStreetSelected(false);
          }}
          editable={!!selectedCity}
          placeholder={selectedCity ? "Rue des Lilas" : "Choisissez d'abord une ville"}
          placeholderTextColor={palette.inkMuted}
        />
        {streetResults.length > 0 && !streetSelected && (
          <View style={styles.suggestions}>
            <FlatList
              data={streetResults}
              keyExtractor={(item) => String(item.id)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  style={styles.suggestionRow}
                  onPress={() => {
                    setStreetName(item.name);
                    setStreetSelected(true);
                    setStreetResults([]);
                  }}
                >
                  <Text style={styles.suggestionText}>{item.name}</Text>
                </Pressable>
              )}
            />
          </View>
        )}

        <Text style={styles.label}>Numéro (facultatif)</Text>
        <TextInput
          style={styles.input}
          value={houseNumber}
          onChangeText={setHouseNumber}
          keyboardType="number-pad"
          placeholder="12"
          placeholderTextColor={palette.inkMuted}
        />

        <Pressable
          style={styles.checkboxRow}
          onPress={() => setAgeConfirmed((confirmed) => !confirmed)}
        >
          <View
            style={[
              styles.checkbox,
              ageConfirmed && styles.checkboxChecked,
            ]}
          />
          <Text style={styles.checkboxLabel}>{AGE_CONSENT_TEXT}</Text>
        </Pressable>

        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color={palette.paperWarm} />
            : <Text style={styles.buttonText}>Recevoir mon code</Text>}
        </Pressable>

        {
          /* Cf. web/components/Header.tsx : lien "Connexion" toujours
            visible pour un habitant non connecté — mobile n'a pas d'en-tête
            persistante ici (cf. AppHeader, réservée aux écrans connectés),
            donc ce lien en bas de formulaire en tient lieu. Utile
            notamment si `join` échoue avec "cet e-mail est déjà inscrit"
            (cf. routes/api/v1/join.ts). */
        }
        <Pressable onPress={() => router.push("/(auth)/connexion")}>
          <Text style={styles.link}>Déjà inscrit·e ? Se connecter</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: palette.paper },
    container: { padding: 24, gap: 4 },
    title: {
      fontFamily: fontDisplay,
      fontSize: 28,
      fontWeight: "700",
      color: palette.ink,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 15,
      color: palette.inkSoft,
      marginBottom: 16,
    },
    error: {
      color: palette.danger,
      marginBottom: 12,
      fontSize: 14,
    },
    label: {
      fontSize: 13,
      fontWeight: "600",
      color: palette.inkSoft,
      marginTop: 12,
      marginBottom: 4,
    },
    input: {
      borderWidth: 2,
      borderColor: palette.borderStrong,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 16,
      color: palette.ink,
      backgroundColor: palette.paper,
    },
    suggestions: {
      maxHeight: 180,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radius.md,
      marginTop: 4,
      backgroundColor: palette.paper,
    },
    suggestionRow: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
    },
    suggestionText: { fontSize: 15, color: palette.ink },
    checkboxRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      marginTop: 20,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: palette.borderStrong,
      marginTop: 2,
    },
    checkboxChecked: {
      backgroundColor: palette.brand,
      borderColor: palette.brand,
    },
    checkboxLabel: { flex: 1, fontSize: 13, color: palette.inkSoft },
    button: {
      backgroundColor: palette.brand,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 24,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: palette.paperWarm, fontSize: 16, fontWeight: "700" },
    link: {
      textAlign: "center",
      color: palette.brand,
      fontSize: 14,
      fontWeight: "600",
      marginTop: 16,
    },
  });
}
