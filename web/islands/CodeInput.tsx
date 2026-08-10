import { useEffect, useRef, useState } from "preact/hooks";

interface CodeInputProps {
  name: string;
  length?: number;
}

/**
 * Saisie du code à 6 chiffres reçu par e-mail : une case par chiffre, focus
 * automatique sur la case suivante à la saisie, et un champ caché `name`
 * recomposant le code complet pour la soumission du formulaire.
 *
 * Sans JS, cette version à cases séparées ne peut pas recomposer le champ
 * caché : on rend alors un simple `<input name={name}>` à la place.
 *
 * Le rendu initial (serveur *et* tout premier rendu client, avant montage)
 * reste ce simple fallback : basculer sur `IS_BROWSER` ferait différer la
 * structure DOM entre le HTML serveur et le premier rendu client, que
 * l'hydratation Preact ne sait pas réconcilier proprement (les deux
 * versions restent affichées l'une sous l'autre). On ne bascule vers les
 * cases qu'après montage (`useEffect`), un rendu client normal que Preact
 * sait remplacer sans ambiguïté.
 */
export default function CodeInput({ name, length = 6 }: CodeInputProps) {
  const [digits, setDigits] = useState<string[]>(Array(length).fill(""));
  const [mounted, setMounted] = useState(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <input
        type="text"
        name={name}
        inputMode="numeric"
        pattern={`[0-9]{${length}}`}
        maxLength={length}
        class="lookup-form__input code-input__fallback"
        autoFocus
        required
        aria-label="Code à 6 chiffres"
      />
    );
  }

  function handleInput(index: number, raw: string) {
    const digit = raw.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (digit && index < length - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent) {
    const target = e.currentTarget as HTMLInputElement;
    if (e.key === "Backspace" && !target.value && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: ClipboardEvent) {
    const pasted = e.clipboardData?.getData("text") ?? "";
    const pastedDigits = pasted.replace(/\D/g, "").slice(0, length).split("");
    if (pastedDigits.length === 0) return;
    e.preventDefault();

    const next = Array(length).fill("");
    pastedDigits.forEach((d, i) => {
      next[i] = d;
    });
    setDigits(next);
    inputsRef.current[Math.min(pastedDigits.length, length) - 1]?.focus();
  }

  return (
    <div class="code-input">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            inputsRef.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          class="code-input__box"
          value={digit}
          autoFocus={index === 0}
          onInput={(e) => handleInput(index, e.currentTarget.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          aria-label={`Chiffre ${index + 1} du code`}
        />
      ))}
      <input type="hidden" name={name} value={digits.join("")} />
    </div>
  );
}
