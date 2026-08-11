import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildInviteEmail,
  buildLoginCodeEmail,
  buildStreetAwakeningEmail,
} from "./brevo.ts";

Deno.test("les trois e-mails portent l'en-tête commun (logo + nom du site)", () => {
  const emails = [
    buildLoginCodeEmail(
      "camille@exemple.fr",
      "042817",
      "no-reply@notrerue.fr",
      "https://notrerue.fr/connexion",
    ),
    buildInviteEmail(
      {
        to: "voisin@exemple.fr",
        inviterLogin: "camille",
        inviterEmail: "camille@exemple.fr",
        streetName: "Rue des Lilas",
        cityName: "Nantes",
        joinUrl: "https://notrerue.fr/rejoindre",
      },
      "no-reply@notrerue.fr",
    ),
    buildStreetAwakeningEmail(
      {
        to: "camille@exemple.fr",
        recipientLogin: "camille",
        streetName: "Rue des Lilas",
        cityName: "Nantes",
        homeUrl: "https://notrerue.fr/",
      },
      "no-reply@notrerue.fr",
    ),
  ];

  for (const email of emails) {
    assertStringIncludes(email.htmlContent, "◍");
    assertStringIncludes(email.htmlContent, "NotreRue.fr");
    assertStringIncludes(
      email.htmlContent,
      "l'entraide entre voisins, sans réseau social ni publicité.",
    );
  }
});

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

Deno.test("buildStreetAwakeningEmail : forme du payload", () => {
  const payload = buildStreetAwakeningEmail(
    {
      to: "camille@exemple.fr",
      recipientLogin: "camille",
      streetName: "Rue des Lilas",
      cityName: "Nantes",
      homeUrl: "https://notrerue.fr/",
    },
    "no-reply@notrerue.fr",
  );

  assertEquals(payload.sender, {
    email: "no-reply@notrerue.fr",
    name: "NotreRue.fr",
  });
  assertEquals(payload.to, [{ email: "camille@exemple.fr" }]);
  assertEquals(payload.subject, "Votre rue Rue des Lilas est allumée !");
  assertEquals(payload.htmlContent.includes("Rue des Lilas"), true);
  assertEquals(payload.htmlContent.includes("Nantes"), true);
  assertEquals(payload.htmlContent.includes("https://notrerue.fr/"), true);
});

Deno.test("buildStreetAwakeningEmail : échappe le HTML dans le login/rue/ville avant interpolation", () => {
  const payload = buildStreetAwakeningEmail(
    {
      to: "camille@exemple.fr",
      recipientLogin: `<img src=x onerror=alert(1)>`,
      streetName: `Rue "des" Lilas`,
      cityName: "Nantes",
      homeUrl: "https://notrerue.fr/",
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
