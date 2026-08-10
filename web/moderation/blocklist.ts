// Sous-chemin direct plutôt que l'entrée principale du paquet (qui exporte
// { object, array, regex }) : sous Vite SSR, l'interop CJS de cette forme
// imbriquée ne restitue pas un vrai tableau itérable pour `.array` (marche
// en `deno run`/`deno test`, casse uniquement via le serveur de dev Vite).
// Le sous-module `array.js` exporte directement un tableau, sans ce problème.
import BADWORDS_ARRAY from "french-badwords-list/dist/array.js";

/**
 * Bloque un message avant publication s'il contient une insulte, un terme
 * discriminatoire ou une menace explicite — cf. backlog « les messages
 * agressifs ou discriminatoires doivent être bloqués avant publication ».
 *
 * Approche volontairement simple (correspondance de mots contre une liste,
 * pas de ML/appel réseau) : gratuite, instantanée, sans dépendance externe.
 * Limite connue et acceptée : contournable par des tournures indirectes ou
 * des fautes volontaires non couvertes par la liste — à surveiller via les
 * signalements une fois cette fonctionnalité construite (cf. backlog).
 *
 * La base de mots vient de `french-badwords-list` (insultes, termes
 * discriminatoires, variantes « leet speak » type "c0nn4rd") plutôt que
 * d'une liste réécrite à la main. Complétée ci-dessous par quelques menaces
 * explicites, catégorie que cette liste (orientée profanité) ne couvre pas.
 */
const THREAT_PHRASES = [
  "je vais te tuer",
  "je vais te crever",
  "va crever",
  "je vais te défoncer",
  "je vais te démolir",
  "je vais te casser la gueule",
  "je vais t'exploser",
  "je vais te massacrer",
];

/**
 * `\b` (JS) ne considère que `[A-Za-z0-9_]` comme caractères de mot : un
 * terme se terminant par une voyelle accentuée ("pédé", "enculé"...) ne
 * matche alors plus en fin de chaîne ou devant un espace, ce qui est
 * fréquent en français. On reconstruit la même idée avec des lookarounds
 * Unicode (`\p{L}`) pour que les accents soient traités comme des lettres.
 */
function buildBlocklistPattern(terms: readonly string[]): RegExp {
  const escaped = terms.map((term) =>
    term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${escaped.join("|")})(?![\\p{L}\\p{N}_])`,
    "iu",
  );
}

const BLOCKLIST_PATTERN = buildBlocklistPattern([
  ...(BADWORDS_ARRAY as string[]),
  ...THREAT_PHRASES,
]);

/** Vrai si `text` contient un terme bloqué (insulte, slur, menace). */
export function containsBlockedContent(text: string): boolean {
  return BLOCKLIST_PATTERN.test(text);
}
