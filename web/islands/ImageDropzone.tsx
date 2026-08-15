import { useEffect, useRef, useState } from "preact/hooks";
import { IS_BROWSER } from "fresh/runtime";
import type { ComponentChildren } from "preact";

interface ImageDropzoneProps {
  /** Le `<input type="file">` à enrichir, seul enfant attendu (cf. routes/fil.tsx). */
  children: ComponentChildren;
}

/**
 * Habille un `<input type="file">` d'une zone cliquable/glisser-déposer
 * (cf. backlog « ajouter un fichier au clic sur un bouton plus joli et par
 * drag and drop »), sans réimplémenter le champ lui-même — l'enfant reste
 * le `<input>` natif, seul à porter `name="image"`/`accept`/etc.
 *
 * Le clic pour choisir un fichier fonctionne nativement via le `<label
 * for>` posé par le parent (cf. fil.tsx) : aucun JS requis pour ça. Ce qui
 * ne peut être fait qu'ici (règle Fresh n°1) : le glisser-déposer (aucun
 * équivalent HTML natif) et l'affichage du nom du fichier choisi.
 *
 * Sans JS, seuls l'enfant et le libellé cliquable posés par le parent
 * s'affichent — dégradation propre, le formulaire reste utilisable (juste
 * sans glisser-déposer ni retour visuel sur le nom du fichier).
 */
export default function ImageDropzone({ children }: ImageDropzoneProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!IS_BROWSER) return;
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
  }, []);

  const clearFile = () => {
    const input = wrapperRef.current?.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    if (input) input.value = "";
    setFileName(null);
  };

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
