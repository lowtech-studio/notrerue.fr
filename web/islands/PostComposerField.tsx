import { useEffect, useRef, useState } from "preact/hooks";
import { IS_BROWSER } from "fresh/runtime";
import type { ComponentChildren } from "preact";

interface PostComposerFieldProps {
  /**
   * `"placeholder"` : adapte le placeholder du champ `content` au type
   * sélectionné (ex `PostTypePlaceholder.tsx`). `"dropzone"` : glisser-
   * déposer + nom du fichier choisi sur le champ image (ex
   * `ImageDropzone.tsx`).
   */
  variant: "placeholder" | "dropzone";
  /** Placeholder à poser sur le champ `content`, selon la valeur du radio `type` sélectionné — `variant="placeholder"` seulement. */
  placeholders?: Record<string, string>;
  /** Les champs enveloppés : radiogroup `type`/durée + `content` (`placeholder`), ou `<input type="file">` + son `<label>` cliquable (`dropzone`). */
  children: ComponentChildren;
}

/**
 * Les deux seuls enrichissements JS du formulaire de publication de
 * routes/fil.tsx, réunis dans une seule île plutôt que deux (ex
 * `PostTypePlaceholder.tsx` et `ImageDropzone.tsx`) — elles ne sont
 * utilisées qu'ensemble, dans ce seul formulaire, et les fusionner évite de
 * payer deux fois le même graphe de dépendances partagées
 * (preact/hooks/jsxRuntime/shared) au chargement de /fil : un nœud de moins
 * dans la chaîne de requêtes critique (cf. revue perf, rapport Lighthouse).
 * `variant` distingue les deux comportements plutôt que deux exports, pour
 * que les deux usages de routes/fil.tsx partagent le même fichier — donc le
 * même chunk JS — au lieu d'en télécharger un chacun.
 *
 * Aucun des deux effets ne réimplémente les champs eux-mêmes (règle Fresh
 * n°1 : seulement ce qu'aucun CSS ne peut faire) : le clic pour choisir un
 * fichier fonctionne nativement via le `<label for>` posé par le parent,
 * seuls le glisser-déposer et le retour visuel (nom du fichier, placeholder
 * dynamique) vivent ici. Sans JS, seuls les enfants s'affichent tels quels
 * dans les deux cas : dégradation propre, même contrat que les deux îles
 * d'origine.
 */
export default function PostComposerField(
  { variant, placeholders, children }: PostComposerFieldProps,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!IS_BROWSER || variant !== "placeholder") return;
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
      const placeholder = placeholders?.[radio.value];
      if (radio.checked && placeholder) field.placeholder = placeholder;
    };

    for (const radio of radios) radio.addEventListener("change", update);
    return () => {
      for (const radio of radios) radio.removeEventListener("change", update);
    };
  }, [variant, placeholders]);

  useEffect(() => {
    if (!IS_BROWSER || variant !== "dropzone") return;
    const wrapper = wrapperRef.current;
    const input = wrapper?.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    const dropzone = wrapper?.querySelector<HTMLLabelElement>(
      ".image-dropzone__area",
    );
    if (!wrapper || !input || !dropzone) return;

    const updateFileName = () => setFileName(input.files?.[0]?.name ?? null);
    updateFileName();
    input.addEventListener("change", updateFileName);

    // `dragenter`/`dragover` doivent appeler `preventDefault()` pour que le
    // navigateur autorise `drop` sur cet élément (comportement par défaut :
    // ouvrir le fichier dans l'onglet). `dragleave` se déclenche aussi en
    // survolant un enfant (l'icône, le texte) : le compteur évite de faire
    // clignoter `isDragging` à chaque passage d'un enfant à l'autre.
    let dragCounter = 0;
    const onDragEnter = (event: DragEvent) => {
      event.preventDefault();
      dragCounter++;
      setIsDragging(true);
    };
    const onDragOver = (event: DragEvent) => event.preventDefault();
    const onDragLeave = () => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) setIsDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      dragCounter = 0;
      setIsDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      // Un `FileList` ne se construit pas directement : `DataTransfer` est
      // le seul moyen documenté d'en fabriquer un assignable à
      // `input.files`, pour que ce fichier parte bien avec le reste du
      // formulaire à la soumission (POST /fil).
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      updateFileName();
    };

    dropzone.addEventListener("dragenter", onDragEnter);
    dropzone.addEventListener("dragover", onDragOver);
    dropzone.addEventListener("dragleave", onDragLeave);
    dropzone.addEventListener("drop", onDrop);
    return () => {
      input.removeEventListener("change", updateFileName);
      dropzone.removeEventListener("dragenter", onDragEnter);
      dropzone.removeEventListener("dragover", onDragOver);
      dropzone.removeEventListener("dragleave", onDragLeave);
      dropzone.removeEventListener("drop", onDrop);
    };
  }, [variant]);

  const clearFile = () => {
    const input = wrapperRef.current?.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    if (input) input.value = "";
    setFileName(null);
  };

  if (variant === "dropzone") {
    return (
      <div
        ref={wrapperRef}
        class={`image-dropzone${isDragging ? " image-dropzone--active" : ""}`}
      >
        {children}
        {fileName && (
          <p class="image-dropzone__filename">
            {fileName}{" "}
            <button
              type="button"
              class="image-dropzone__clear"
              onClick={clearFile}
            >
              Retirer
            </button>
          </p>
        )}
      </div>
    );
  }

  return (
    // `.post-type-placeholder-field` (display: contents, cf. common.css) :
    // transparente à la mise en page du formulaire parent (grid + gap),
    // même raison que `.character-counter-field` (cf.
    // islands/CharacterCounter.tsx).
    <div ref={wrapperRef} class="post-type-placeholder-field">
      {children}
    </div>
  );
}
