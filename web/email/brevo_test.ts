import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildInviteEmail,
  buildLoginCodeEmail,
  buildMessageNotificationEmail,
  buildPendingNeighborEmail,
  buildReplyNotificationEmail,
  buildStreetAwakeningEmail,
  buildTapNotificationEmail,
} from "./brevo.ts";

Deno.test("tous les e-mails transactionnels portent l'en-tête (logo + nom du site) et le pied de page commun", () => {
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
    buildTapNotificationEmail(
      {
        to: "camille@exemple.fr",
        recipientLogin: "camille",
        tapperLogin: "quentin",
        postType: "cherche",
        postContent: "Je cherche une perceuse",
        threadUrl: "https://notrerue.fr/messages?with=2",
      },
      "no-reply@notrerue.fr",
    ),
    buildReplyNotificationEmail(
      {
        to: "camille@exemple.fr",
        recipientLogin: "camille",
        replierLogin: "quentin",
        postContent: "Un bon plombier ?",
        replyContent: "Dupont Plomberie",
        threadUrl: "https://notrerue.fr/fil",
      },
      "no-reply@notrerue.fr",
    ),
    buildMessageNotificationEmail(
      {
        to: "camille@exemple.fr",
        recipientLogin: "camille",
        senderLogin: "quentin",
        threadUrl: "https://notrerue.fr/messages?with=2",
      },
      "no-reply@notrerue.fr",
    ),
    buildPendingNeighborEmail(
      {
        to: "camille@exemple.fr",
        recipientLogin: "camille",
        newcomerLogin: "julien",
        streetName: "Rue des Lilas",
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
      "entraide et bons plans entre voisins.",
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

Deno.test("buildInviteEmail : sans mot personnel → aucun paragraphe de citation ajouté", () => {
  const payload = buildInviteEmail(
    {
      to: "voisin@exemple.fr",
      inviterLogin: "camille",
      inviterEmail: "camille@exemple.fr",
      streetName: "Rue des Lilas",
      cityName: "Nantes",
      joinUrl: "https://notrerue.fr/rejoindre",
    },
    "no-reply@notrerue.fr",
  );

  assertEquals(payload.htmlContent.includes("«"), false);
});

Deno.test("buildInviteEmail : mot personnel → repris entre guillemets, échappé, retours à la ligne convertis", () => {
  const payload = buildInviteEmail(
    {
      to: "voisin@exemple.fr",
      inviterLogin: "camille",
      inviterEmail: "camille@exemple.fr",
      streetName: "Rue des Lilas",
      cityName: "Nantes",
      joinUrl: "https://notrerue.fr/rejoindre",
      personalMessage:
        `On se croise souvent au parc <3\nViens nous rejoindre !`,
    },
    "no-reply@notrerue.fr",
  );

  assertStringIncludes(
    payload.htmlContent,
    "« On se croise souvent au parc &lt;3<br>Viens nous rejoindre ! »",
  );
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

Deno.test("buildPendingNeighborEmail : forme du payload", () => {
  const payload = buildPendingNeighborEmail(
    {
      to: "camille@exemple.fr",
      recipientLogin: "camille",
      newcomerLogin: "julien",
      streetName: "Rue des Lilas",
      homeUrl: "https://notrerue.fr/",
    },
    "no-reply@notrerue.fr",
  );

  assertEquals(payload.sender, {
    email: "no-reply@notrerue.fr",
    name: "NotreRue.fr",
  });
  assertEquals(payload.to, [{ email: "camille@exemple.fr" }]);
  assertEquals(
    payload.subject,
    "julien a rejoint Rue des Lilas et attend d'être validé",
  );
  assertEquals(payload.htmlContent.includes("julien"), true);
  assertEquals(payload.htmlContent.includes("Rue des Lilas"), true);
  assertEquals(payload.htmlContent.includes("https://notrerue.fr/"), true);
});

Deno.test("buildPendingNeighborEmail : échappe le HTML dans les logins/rue avant interpolation", () => {
  const payload = buildPendingNeighborEmail(
    {
      to: "camille@exemple.fr",
      recipientLogin: "camille",
      newcomerLogin: `<img src=x onerror=alert(1)>`,
      streetName: `Rue "des" Lilas`,
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

Deno.test("buildTapNotificationEmail : forme du payload, libellé selon le type", () => {
  const payload = buildTapNotificationEmail(
    {
      to: "camille@exemple.fr",
      recipientLogin: "camille",
      tapperLogin: "quentin",
      postType: "propose",
      postContent: "Je prête ma tondeuse",
      threadUrl: "https://notrerue.fr/messages?with=2&postId=9",
    },
    "no-reply@notrerue.fr",
  );

  assertEquals(payload.to, [{ email: "camille@exemple.fr" }]);
  assertEquals(
    payload.subject,
    "quentin a répondu à votre demande sur NotreRue.fr",
  );
  // Libellé du bouton de tap correspondant au type ("propose" → "Intéressé"),
  // pas un texte générique déconnecté du reste du site.
  assertStringIncludes(payload.htmlContent, "Intéressé");
  assertStringIncludes(payload.htmlContent, "Je prête ma tondeuse");
  assertStringIncludes(
    payload.htmlContent,
    "https://notrerue.fr/messages?with=2&postId=9",
  );
});

Deno.test("buildTapNotificationEmail : échappe le HTML du login/contenu avant interpolation", () => {
  const payload = buildTapNotificationEmail(
    {
      to: "camille@exemple.fr",
      recipientLogin: "camille",
      tapperLogin: `<img src=x onerror=alert(1)>`,
      postType: "cherche",
      postContent: `Une perceuse "costaud" ?`,
      threadUrl: "https://notrerue.fr/messages?with=2",
    },
    "no-reply@notrerue.fr",
  );

  assertEquals(payload.htmlContent.includes("<img"), false);
  assertStringIncludes(
    payload.htmlContent,
    "&lt;img src=x onerror=alert(1)&gt;",
  );
  assertStringIncludes(
    payload.htmlContent,
    "Une perceuse &quot;costaud&quot; ?",
  );
});

Deno.test("buildReplyNotificationEmail : forme du payload", () => {
  const payload = buildReplyNotificationEmail(
    {
      to: "camille@exemple.fr",
      recipientLogin: "camille",
      replierLogin: "quentin",
      postContent: "Un bon plombier ?",
      replyContent: "Dupont Plomberie, très sérieux",
      threadUrl: "https://notrerue.fr/fil",
    },
    "no-reply@notrerue.fr",
  );

  assertEquals(payload.to, [{ email: "camille@exemple.fr" }]);
  assertEquals(
    payload.subject,
    "quentin a répondu à votre demande sur NotreRue.fr",
  );
  assertStringIncludes(payload.htmlContent, "Un bon plombier ?");
  assertStringIncludes(payload.htmlContent, "Dupont Plomberie, très sérieux");
  assertStringIncludes(payload.htmlContent, "https://notrerue.fr/fil");
});

Deno.test("buildReplyNotificationEmail : échappe le HTML avant interpolation", () => {
  const payload = buildReplyNotificationEmail(
    {
      to: "camille@exemple.fr",
      recipientLogin: "camille",
      replierLogin: `<img src=x onerror=alert(1)>`,
      postContent: "Un bon plombier ?",
      replyContent: `Dupont "Plomberie"`,
      threadUrl: "https://notrerue.fr/fil",
    },
    "no-reply@notrerue.fr",
  );

  assertEquals(payload.htmlContent.includes("<img"), false);
  assertStringIncludes(
    payload.htmlContent,
    "&lt;img src=x onerror=alert(1)&gt;",
  );
  assertStringIncludes(payload.htmlContent, "Dupont &quot;Plomberie&quot;");
});

Deno.test("buildMessageNotificationEmail : forme du payload, sans le contenu du message", () => {
  const payload = buildMessageNotificationEmail(
    {
      to: "camille@exemple.fr",
      recipientLogin: "camille",
      senderLogin: "quentin",
      threadUrl: "https://notrerue.fr/messages?with=2",
    },
    "no-reply@notrerue.fr",
  );

  assertEquals(payload.to, [{ email: "camille@exemple.fr" }]);
  assertEquals(payload.subject, "Nouveau message de quentin sur NotreRue.fr");
  assertStringIncludes(payload.htmlContent, "quentin");
  assertStringIncludes(
    payload.htmlContent,
    "https://notrerue.fr/messages?with=2",
  );
  // Donnée privée : le contenu du message ne doit jamais transiter par
  // l'e-mail (cf. revue), seule sa notification d'existence.
  assertStringIncludes(
    payload.htmlContent,
    "n'est pas repris dans cet e-mail",
  );
});

Deno.test("buildMessageNotificationEmail : échappe le HTML du login avant interpolation", () => {
  const payload = buildMessageNotificationEmail(
    {
      to: "camille@exemple.fr",
      recipientLogin: "camille",
      senderLogin: `<img src=x onerror=alert(1)>`,
      threadUrl: "https://notrerue.fr/messages?with=2",
    },
    "no-reply@notrerue.fr",
  );

  assertEquals(payload.htmlContent.includes("<img"), false);
  assertStringIncludes(
    payload.htmlContent,
    "&lt;img src=x onerror=alert(1)&gt;",
  );
});
