import type { ComponentChildren } from "preact";

interface PrintButtonProps {
  children: ComponentChildren;
  class?: string;
}

/**
 * Déclenche l'impression navigateur (`window.print()`). Seule interaction
 * de /inviter qui a besoin de JS : le reste (mailto:, wa.me) sont de simples
 * liens, servis même sans JavaScript.
 */
export default function PrintButton(
  { children, class: className }: PrintButtonProps,
) {
  return (
    <button
      type="button"
      class={className}
      onClick={() => globalThis.print()}
    >
      {children}
    </button>
  );
}
