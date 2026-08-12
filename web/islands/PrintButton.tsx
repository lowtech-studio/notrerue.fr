import type { ComponentChildren } from "preact";

interface PrintButtonProps {
  children: ComponentChildren;
  class?: string;
  /**
   * Quand la page imprimable contient plusieurs feuilles distinctes (kit
   * papier / autocollant sur /inviter), indique laquelle imprimer via
   * `data-print-target` sur `<body>` : le CSS `@media print` masque les
   * autres feuilles. Omis si la page n'a qu'un seul contenu imprimable.
   */
  target?: string;
}

/**
 * Déclenche l'impression navigateur (`window.print()`). Seule interaction
 * de /inviter qui a besoin de JS : le reste (mailto:, wa.me) sont de simples
 * liens, servis même sans JavaScript.
 */
export default function PrintButton(
  { children, class: className, target }: PrintButtonProps,
) {
  return (
    <button
      type="button"
      class={className}
      onClick={() => {
        if (!target) {
          globalThis.print();
          return;
        }
        document.body.dataset.printTarget = target;
        // Nettoyé après l'impression (fermeture de la boîte de dialogue,
        // succès ou annulation) : sans ça, `data-print-target` restait posé
        // et un Ctrl+P direct ultérieur n'imprimait plus que cette dernière
        // feuille choisie (cf. revue).
        const clearTarget = () => {
          delete document.body.dataset.printTarget;
          globalThis.removeEventListener("afterprint", clearTarget);
        };
        globalThis.addEventListener("afterprint", clearTarget);
        globalThis.print();
      }}
    >
      {children}
    </button>
  );
}
