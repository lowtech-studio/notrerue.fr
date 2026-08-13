import { useEffect, useRef } from "preact/hooks";
import { IS_BROWSER } from "fresh/runtime";
import type { ComponentChildren } from "preact";

interface PostTypePlaceholderProps {
  /** Placeholder à poser sur le champ `content`, selon la valeur du radio `type` sélectionné. */
  placeholders: Record<string, string>;
  /** Le radiogroup `type` et le champ `content` (via CharacterCounter), attendus quelque part dans l'arbre. */
  children: ComponentChildren;
}

/**
 * Adapte le placeholder du champ de saisie au type de publication choisi
 * (cf. backlog « donner de meilleures idées ») — un exemple différent pour
 * "Je cherche"/"Je propose"/"J'informe" plutôt qu'un seul exemple générique.
 * Ne réagit qu'au changement du radio (règle Fresh n°1 : ça vit forcément
 * dans un island), sans réimplémenter le formulaire — juste une écoute posée
 * sur les champs déjà rendus par le parent.
 *
 * Sans JS, seul le placeholder initial (posé côté serveur selon le type
 * pré-sélectionné) reste affiché : dégradation propre, pas de formulaire cassé.
 */
export default function PostTypePlaceholder(
  { placeholders, children }: PostTypePlaceholderProps,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!IS_BROWSER) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const radios = wrapper.querySelectorAll<HTMLInputElement>(
      'input[type="radio"][name="type"]',
    );
    const field = wrapper.querySelector<HTMLInputElement>(
      'input[name="content"]',
    );
    if (!field || radios.length === 0) return;

    const update = (event: Event) => {
      const radio = event.currentTarget as HTMLInputElement;
      const placeholder = placeholders[radio.value];
      if (radio.checked && placeholder) field.placeholder = placeholder;
    };

    for (const radio of radios) radio.addEventListener("change", update);
    return () => {
      for (const radio of radios) radio.removeEventListener("change", update);
    };
  }, [placeholders]);

  return (
    // `.post-type-placeholder-field` (display: contents, cf. common.css) :
    // transparent à la mise en page du formulaire parent (grid + gap), même
    // raison que `.character-counter-field` (cf. islands/CharacterCounter.tsx).
    <div ref={wrapperRef} class="post-type-placeholder-field">
      {children}
    </div>
  );
}
