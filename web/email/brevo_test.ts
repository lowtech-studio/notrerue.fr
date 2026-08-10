import { assertEquals } from "@std/assert";
import { buildInviteEmail, buildLoginCodeEmail } from "./brevo.ts";

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

Deno.test("buildInviteEmail : forme du payload, reply-to l'invitant", () => {
  const payload = buildInviteEmail(
    {
      to: "voisin@exemple.fr",
      inviterLogin: "camille",
      inviterEmail: "camille@exemple.fr",
      streetName: "Rue des Lilas",
      cityName: "Nantes",
      joinUrl: "https://notrerue.fr/rejoindre?cityId=1&street=Rue+des+Lilas",
    },
    "no-reply@notrerue.fr",
  );

  assertEquals(payload.sender, {
    email: "no-reply@notrerue.fr",
    name: "NotreRue.fr",
  });
  assertEquals(payload.to, [{ email: "voisin@exemple.fr" }]);
  assertEquals(payload.replyTo, {
    email: "camille@exemple.fr",
    name: "camille",
  });
  assertEquals(
    payload.subject,
    "camille vous invite à rejoindre votre rue sur NotreRue.fr",
  );
  assertEquals(payload.htmlContent.includes("Rue des Lilas"), true);
  assertEquals(payload.htmlContent.includes("Nantes"), true);
  assertEquals(
    payload.htmlContent.includes(
      "https://notrerue.fr/rejoindre?cityId=1&street=Rue+des+Lilas",
    ),
    true,
  );
});

Deno.test("buildInviteEmail : échappe le HTML dans le login/rue/ville avant interpolation", () => {
  const payload = buildInviteEmail(
    {
      to: "voisin@exemple.fr",
      inviterLogin: `<img src=x onerror=alert(1)>`,
      inviterEmail: "camille@exemple.fr",
      streetName: `Rue "des" Lilas`,
      cityName: "Nantes",
      joinUrl: "https://notrerue.fr/rejoindre",
    },
    "no-reply@notrerue.fr",
  );

  assertEquals(payload.htmlContent.includes("<img"), false);
  assertEquals(
    payload.htmlContent.includes("&lt;img src=x onerror=alert(1)&gt;"),
    true,
  );
  assertEquals(payload.htmlContent.includes("Rue &quot;des&quot; Lilas"), true);
});
