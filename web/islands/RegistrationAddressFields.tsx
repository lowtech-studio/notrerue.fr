import { useEffect, useRef, useState } from "preact/hooks";
import { IS_BROWSER } from "fresh/runtime";

interface CitySuggestion {
  id: number;
  name: string;
  postalCodes: string[];
  department: string;
}

interface StreetSuggestion {
  id: number;
  name: string;
}

const DEBOUNCE_MS = 200;

function useDebouncedFetch<T>(
  url: string | null,
  minLength: number,
  query: string,
): T[] {
  const [results, setResults] = useState<T[]>([]);

  useEffect(() => {
    if (!IS_BROWSER || !url || query.trim().length < minLength) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.ok) setResults(await res.json());
      } catch {
        // Requête annulée par une saisie plus récente : rien à faire.
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [url, query]);

  return results;
}

interface RegistrationAddressFieldsProps {
  /** Ville déjà sélectionnée lors d'une soumission précédente en erreur. */
  initialCityId?: number | null;
  /** Libellé affiché correspondant à `initialCityId` (ville + département). */
  initialCityLabel?: string;
  /** Rue déjà saisie lors d'une soumission précédente en erreur. */
  initialStreet?: string;
}

/**
 * Champs ville + rue de /rejoindre. La ville doit être choisie dans les
 * suggestions (un input caché `cityId` porte l'identifiant réel) : sans JS,
 * ce champ reste soumis en texte libre et le serveur affichera une erreur
 * demandant de réessayer — pas de repli <select> à 35 000 options.
 * La rue reste en texte libre : si elle n'existe pas encore pour la ville
 * choisie, elle est créée à la soumission.
 *
 * `initial*` permet de réafficher un choix déjà fait après un formulaire
 * renvoyé en erreur (ex. login déjà pris) sans faire tout ressaisir.
 */
export default function RegistrationAddressFields({
  initialCityId = null,
  initialCityLabel = "",
  initialStreet = "",
}: RegistrationAddressFieldsProps) {
  const [cityQuery, setCityQuery] = useState(initialCityLabel);
  const [cityId, setCityId] = useState<number | "">(initialCityId ?? "");
  const [streetQuery, setStreetQuery] = useState(initialStreet);
  const [cityOpen, setCityOpen] = useState(false);
  const [streetOpen, setStreetOpen] = useState(false);
  const cityInputRef = useRef<HTMLInputElement>(null);

  const cityUrl = cityOpen
    ? `/api/villes?q=${encodeURIComponent(cityQuery)}`
    : null;
  const cityResults = useDebouncedFetch<CitySuggestion>(
    cityUrl,
    2,
    cityQuery,
  );

  const streetUrl = streetOpen && cityId !== ""
    ? `/api/rues?cityId=${cityId}&q=${encodeURIComponent(streetQuery)}`
    : null;
  const streetResults = useDebouncedFetch<StreetSuggestion>(
    streetUrl,
    2,
    streetQuery,
  );

  function selectCity(suggestion: CitySuggestion) {
    setCityId(suggestion.id);
    setCityQuery(`${suggestion.name} (${suggestion.department})`);
    setCityOpen(false);
    cityInputRef.current?.blur();
  }

  function selectStreet(suggestion: StreetSuggestion) {
    setStreetQuery(suggestion.name);
    setStreetOpen(false);
  }

  return (
    <>
      <div class="autocomplete-field">
        <label class="lookup-card__label" for="city">Ville</label>
        <input
          ref={cityInputRef}
          id="city"
          name="city"
          type="text"
          class="lookup-form__input"
          placeholder="Nantes"
          autocomplete="off"
          required
          value={cityQuery}
          onInput={(e) => {
            setCityQuery(e.currentTarget.value);
            setCityId("");
            setCityOpen(true);
          }}
          onFocus={() => setCityOpen(true)}
          onBlur={() => setTimeout(() => setCityOpen(false), 150)}
        />
        <input type="hidden" name="cityId" value={cityId} />
        {cityOpen && cityResults.length > 0 && (
          <ul class="autocomplete-suggestions">
            {cityResults.map((suggestion) => (
              <li key={suggestion.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectCity(suggestion)}
                >
                  {suggestion.name}{" "}
                  <span class="autocomplete-suggestions__hint">
                    {suggestion.postalCodes.join(", ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div class="autocomplete-field">
        <label class="lookup-card__label" for="street">Rue</label>
        <input
          id="street"
          name="street"
          type="text"
          class="lookup-form__input"
          placeholder="Rue des Lilas"
          autocomplete="off"
          required
          disabled={cityId === ""}
          value={streetQuery}
          onInput={(e) => {
            setStreetQuery(e.currentTarget.value);
            setStreetOpen(true);
          }}
          onFocus={() => setStreetOpen(true)}
          onBlur={() => setTimeout(() => setStreetOpen(false), 150)}
        />
        {cityId === "" && (
          <p class="autocomplete-field__hint">
            Choisissez d'abord une ville dans la liste.
          </p>
        )}
        {streetOpen && streetResults.length > 0 && (
          <ul class="autocomplete-suggestions">
            {streetResults.map((suggestion) => (
              <li key={suggestion.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectStreet(suggestion)}
                >
                  {suggestion.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
