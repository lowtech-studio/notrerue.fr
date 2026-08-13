import { useEffect, useRef, useState } from "preact/hooks";
import { IS_BROWSER } from "fresh/runtime";
import type { ComponentChildren } from "preact";

interface CharacterCounterProps {
  /** Longueur maximale du champ enveloppé (déjà posée en `maxlength` dessus). */
  max: number;
  /** Le `<input>`/`<textarea>` à compter, seul enfant attendu. */
  children: ComponentChildren;
}

/**
 * Affiche « N/max » sous un champ de texte, mis à jour à chaque frappe — cf.
 * backlog « compteur de caractères visible sur les champs limités ». Seule
 * façon de compter en direct : ça vit forcément dans un island (règle Fresh
 * n°1), mais reste minimal — le champ lui-même n'est pas réimplémenté ici,
 * juste enveloppé, pour rester utilisable tel quel dans chaque formulaire
 * (name, required, value... inchangés).
 *
 * Sans JS, seul l'enfant s'affiche (le `maxlength` natif du navigateur
 * continue de border la saisie) : dégradation propre plutôt qu'un compteur
 * cassé.
 */
export default function CharacterCounter(
  { max, children }: CharacterCounterProps,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!IS_BROWSER) return;
    const field = wrapperRef.current?.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >("input, textarea");
    if (!field) return;

    const update = () => setCount(field.value.length);
    update();
    field.addEventListener("input", update);
    return () => field.removeEventListener("input", update);
  }, []);

  return (
    // `.character-counter-field` (display: contents, cf. common.css) : la
    // div ne participe pas à la mise en page (grid/flex du formulaire
    // parent), seuls ses enfants comptent — sans ça, l'enveloppe casserait
    // les règles CSS déjà ciblées sur le champ (ex.
    // `.fil-post__edit-form .lookup-form__input { flex: 1 1 240px }`) dans
    // les formulaires en ligne (cf. revue). Classe plutôt que `style={{}}`
    // inline : une CSP stricte en production n'autorise pas les attributs
    // `style` arbitraires (cf. revue, régression trouvée sur
    // l'autocomplétion de /rejoindre pour une raison voisine).
    <div ref={wrapperRef} class="character-counter-field">
      {children}
      {count !== null && (
        <p class="character-counter" aria-live="polite">
          {count}/{max}
        </p>
      )}
    </div>
  );
}
