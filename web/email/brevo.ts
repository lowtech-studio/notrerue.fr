import { escape as escapeHtml } from "@std/html/entities";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export interface BrevoEmailPayload {
  sender: { email: string; name: string };
  to: { email: string }[];
  subject: string;
  htmlContent: string;
  /** Réponses du destinataire redirigées vers cette adresse plutôt que `sender`. */
  replyTo?: { email: string; name?: string };
}

/** Construction pure du payload — testable sans réseau. */
export function buildLoginCodeEmail(
  to: string,
  code: string,
  from: string,
  loginUrl: string,
): BrevoEmailPayload {
  return {
    sender: { email: from, name: "NotreRue.fr" },
    to: [{ email: to }],
    subject: "Votre code de connexion NotreRue.fr",
    htmlContent:
      `<p>Voici votre code de connexion NotreRue.fr :</p><p style="font-size:28px;font-weight:700;letter-spacing:.1em">${code}</p><p>Il est valable 15 minutes et à usage unique.</p><p><a href="${loginUrl}">Saisir mon code de connexion</a></p>`,
  };
}

export interface InviteEmailInput {
  to: string;
  inviterLogin: string;
  inviterEmail: string;
  streetName: string;
  cityName: string;
  joinUrl: string;
}

/**
 * Construction pure du payload d'invitation — testable sans réseau. Envoyée
 * depuis l'expéditeur vérifié de la plateforme (l'habitant ne peut pas
 * envoyer depuis sa propre adresse sans domaine vérifié), mais `replyTo`
 * pointe vers son adresse à lui : le voisin invité peut répondre directement,
 * sans que NotreRue.fr reste au milieu de l'échange.
 *
 * `inviterLogin`/`streetName`/`cityName` viennent d'un habitant (login choisi
 * à l'inscription, nom de rue/ville en partie libres) : échappés avant
 * interpolation dans le HTML de l'e-mail, qui n'a pas l'échappement
 * automatique de JSX.
 */
export function buildInviteEmail(
  input: InviteEmailInput,
  from: string,
): BrevoEmailPayload {
  const { to, inviterLogin, inviterEmail, streetName, cityName, joinUrl } =
    input;
  const login = escapeHtml(inviterLogin);
  const street = escapeHtml(streetName);
  const city = escapeHtml(cityName);

  return {
    sender: { email: from, name: "NotreRue.fr" },
    to: [{ email: to }],
    replyTo: { email: inviterEmail, name: inviterLogin },
    subject:
      `${inviterLogin} vous invite à rejoindre votre rue sur NotreRue.fr`,
    htmlContent: `<p><strong>${login}</strong> vous invite à rejoindre ` +
      `NotreRue.fr, l'entraide entre voisins de la ${street} (${city}).</p>` +
      `<p>Partage, coup de main, bons plans entre voisins — sans réseau ` +
      `social ni publicité.</p>` +
      `<p><a href="${joinUrl}">Rejoindre la ${street}</a></p>` +
      `<p>Vous pouvez répondre directement à cet e-mail pour joindre ` +
      `${login}.</p>`,
  };
}

function getApiKey(): string {
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) {
    throw new Error(
      "BREVO_API_KEY manquante (voir web/.env.example) : impossible d'envoyer l'e-mail.",
    );
  }
  return key;
}

function getSenderEmail(): string {
  const from = Deno.env.get("EMAIL_FROM");
  if (!from) {
    throw new Error(
      "EMAIL_FROM manquante (voir web/.env.example) : impossible d'envoyer l'e-mail.",
    );
  }
  return from;
}

async function sendEmail(payload: BrevoEmailPayload): Promise<void> {
  const response = await fetch(BREVO_ENDPOINT, {
    method: "POST",
    headers: {
      "api-key": getApiKey(),
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Échec de l'envoi de l'e-mail via Brevo (${response.status}) : ${body}`,
    );
  }
}

export async function sendLoginCodeEmail(
  to: string,
  code: string,
  loginUrl: string,
): Promise<void> {
  await sendEmail(buildLoginCodeEmail(to, code, getSenderEmail(), loginUrl));
}

/** Invitation envoyée par un habitant connecté à un voisin, via l'e-mail vérifié de la plateforme. */
export async function sendInviteEmail(
  input: InviteEmailInput,
): Promise<void> {
  await sendEmail(buildInviteEmail(input, getSenderEmail()));
}
