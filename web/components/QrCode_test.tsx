import { assertEquals, assertStringIncludes } from "@std/assert";
import { render } from "preact-render-to-string";
import { QrCode } from "./QrCode.tsx";

Deno.test("QrCode : rend un SVG carré contenant au moins un module sombre", () => {
  const html = render(
    <QrCode value="https://notrerue.fr/rejoindre?cityId=1&street=Rue+des+Lilas" />,
  );

  assertStringIncludes(html, "<svg");
  assertStringIncludes(html, 'role="img"');
  // Un QR code réel comporte toujours des modules sombres (contenu non vide).
  assertStringIncludes(html, "<rect");
});

Deno.test("QrCode : deux valeurs différentes produisent des SVG différents", () => {
  const a = render(<QrCode value="https://notrerue.fr/a" />);
  const b = render(<QrCode value="https://notrerue.fr/b" />);
  assertEquals(a === b, false);
});
