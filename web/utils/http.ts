/**
 * Vrai si la requête est arrivée en HTTPS. Derrière un reverse proxy qui
 * termine le TLS, `url.protocol` reflète le protocole *interne* (souvent
 * `http:`) : on se fie d'abord à `X-Forwarded-Proto`, posé par le proxy.
 *
 * Un client qui falsifierait cet en-tête ne pourrait que faire croire à tort
 * qu'une requête http est sécurisée (le navigateur ignore de toute façon
 * l'attribut `Secure` sur un cookie posé hors HTTPS) — pas l'inverse : pas de
 * risque à s'y fier tant que l'app est déployée derrière un proxy de
 * confiance qui pose son propre en-tête.
 */
export function isSecureRequest(req: Request, url: URL): boolean {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim().toLowerCase() === "https";
  }
  return url.protocol === "https:";
}
