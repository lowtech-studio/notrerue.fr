import { assertEquals } from "@std/assert";
import { buildLoginCodeEmail } from "./brevo.ts";

Deno.test("buildLoginCodeEmail : forme du payload", () => {
  const payload = buildLoginCodeEmail(
    "camille@exemple.fr",
    "042817",
    "no-reply@notrerue.fr",
    "https://notrerue.fr/connexion?email=camille%40exemple.fr",
  );

  assertEquals(payload.sender, {
    email: "no-reply@notrerue.fr",
    name: "NotreRue.fr",
  });
  assertEquals(payload.to, [{ email: "camille@exemple.fr" }]);
  assertEquals(payload.subject, "Votre code de connexion NotreRue.fr");
  assertEquals(payload.htmlContent.includes("042817"), true);
  assertEquals(
    payload.htmlContent.includes(
      "https://notrerue.fr/connexion?email=camille%40exemple.fr",
    ),
    true,
  );
});
