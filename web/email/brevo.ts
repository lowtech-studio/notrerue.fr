const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export interface BrevoEmailPayload {
  sender: { email: string; name: string };
  to: { email: string }[];
  subject: string;
  htmlContent: string;
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

export async function sendLoginCodeEmail(
  to: string,
  code: string,
  loginUrl: string,
): Promise<void> {
  const payload = buildLoginCodeEmail(to, code, getSenderEmail(), loginUrl);

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
