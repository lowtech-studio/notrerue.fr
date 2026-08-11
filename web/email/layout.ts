/**
 * Habillage commun à tous les e-mails transactionnels (code de connexion,
 * invitation, éveil de rue...) : en-tête avec la marque, carte de contenu,
 * pied de page — cf. backlog « revoir le style de l'ensemble des mails
 * [...] pour faire plus sérieux et de confiance ».
 *
 * Construit en tables imbriquées avec styles inline plutôt qu'en CSS externe
 * ou flexbox/grid : c'est la seule approche fiable dans Outlook desktop
 * (moteur Word, ignore une bonne partie du CSS moderne). Le logo est un
 * badge + nom en CSS pur (même glyphe « ◍ » que le site), pas une image :
 * la plupart des clients mail bloquent les images par défaut, ce qui
 * donnerait une icône cassée à l'ouverture — l'inverse de l'effet recherché.
 */

const COLORS = {
  brand: "#9a3f12",
  paper: "#fffdf8",
  paperWarm: "#fff6ea",
  ink: "#1b1a17",
  inkSoft: "#4a453c",
  inkMuted: "#6b6558",
  border: "#efe7d8",
} as const;

const FONT_SANS =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_DISPLAY = "Georgia, 'Iowan Old Style', Palatino, serif";

/**
 * Bouton d'action à toute épreuve pour e-mail : table imbriquée avec
 * background sur la cellule plutôt qu'un `<a>` stylé en CSS — Outlook
 * desktop ignore padding/border-radius sur un lien simple, pas sur une
 * cellule de tableau.
 */
export function emailButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;">` +
    `<tr><td style="background-color:${COLORS.brand};border-radius:8px;">` +
    `<a href="${href}" style="display:inline-block;padding:14px 24px;` +
    `font-family:${FONT_SANS};font-size:16px;font-weight:700;` +
    `color:${COLORS.paperWarm};text-decoration:none;">${label}</a>` +
    `</td></tr></table>`;
}

/** Paragraphe de corps de texte, marge basse cohérente entre les e-mails. */
export function emailParagraph(html: string, muted = false): string {
  const color = muted ? COLORS.inkSoft : COLORS.ink;
  return `<p style="margin:0 0 16px;color:${color};">${html}</p>`;
}

/**
 * Emballe `bodyHtml` (déjà composé en paragraphes/bouton) dans l'en-tête, la
 * carte et le pied de page communs. `preheaderText` est le texte d'aperçu
 * affiché par la boîte de réception avant l'ouverture (masqué à l'affichage) —
 * évite qu'elle improvise un extrait à partir du premier texte visible.
 */
export function renderEmailLayout(
  bodyHtml: string,
  preheaderText?: string,
): string {
  const preheader = preheaderText
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheaderText}</div>`
    : "";

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>NotreRue.fr</title>
  </head>
  <body style="margin:0;padding:0;background-color:${COLORS.border};font-family:${FONT_SANS};">
    ${preheader}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.border};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:${COLORS.paper};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background-color:${COLORS.brand};padding:24px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="width:40px;height:40px;background-color:${COLORS.paperWarm};border-radius:50%;text-align:center;vertical-align:middle;font-size:22px;line-height:40px;color:${COLORS.brand};">◍</td>
                    <td style="padding-left:12px;vertical-align:middle;">
                      <span style="font-family:${FONT_DISPLAY};font-size:20px;font-weight:700;color:${COLORS.paperWarm};">NotreRue.fr</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;font-family:${FONT_SANS};font-size:16px;line-height:1.6;color:${COLORS.ink};">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px;border-top:1px solid ${COLORS.border};font-family:${FONT_SANS};font-size:13px;line-height:1.5;color:${COLORS.inkMuted};">
                NotreRue.fr — l'entraide entre voisins, sans réseau social ni publicité.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
