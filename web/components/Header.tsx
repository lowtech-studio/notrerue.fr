import type { SessionUser } from "../utils.ts";
import { LogoutIcon, MailIcon, UserIcon } from "./icons.tsx";

/** Deux premières lettres du login, en majuscules — pour l'avatar du menu de compte ci-dessous. */
function initials(login: string): string {
  return login.slice(0, 2).toUpperCase();
}

interface HeaderProps {
  user?: SessionUser | null;
  /**
   * `/fil` et `/messages` redirigent vers `/` tant que la rue n'est pas
   * allumée : ne proposer ces liens que si elle l'est, pour ne pas mener
   * nulle part (cf. revue). `undefined`/`null` masque les deux liens.
   */
  isStreetAwake?: boolean | null;
}

export function Header({ user, isStreetAwake }: HeaderProps = {}) {
  return (
    <header class="site-header">
      <div class="container site-header__bar">
        <a href="/" class="brand">
          <span class="brand__mark" aria-hidden="true">◍</span>
          <span>
            <span class="brand__name">NotreRue.fr</span>
            <span class="brand__tagline">
              Créer du lien entre voisins
            </span>
          </span>
        </a>

        {user
          ? (
            <nav class="site-header__nav">
              {isStreetAwake && (
                <>
                  <a href="/fil" class="site-header__link">
                    Le fil de ma rue
                  </a>
                  <a href="/recommandations" class="site-header__link">
                    Recommandations
                  </a>
                </>
              )}
              {
                /* Toujours accessible, rue endormie ou allumée : la seule
                  action possible tant qu'elle dort (cf. backlog), et celle
                  qui la fait grandir une fois allumée (cf. backlog « rue
                  allumée, inviter des voisins »). */
              }
              <a href="/inviter" class="site-header__link">
                Inviter mes voisins
              </a>

              {
                /* "Mes messages" déplacé ici, à côté de l'avatar de compte
                  (cf. retour utilisateur), en icône seule plutôt qu'un
                  libellé texte — même redirection que /fil tant que la rue
                  n'est pas allumée (cf. HeaderProps.isStreetAwake). */
              }
              {isStreetAwake && (
                <a
                  href="/messages"
                  class="site-header__icon-link"
                  aria-label="Mes messages"
                >
                  <MailIcon class="site-header__icon-link-icon" />
                </a>
              )}

              {
                /* Menu de compte : <details> natif (même logique sans JS que
                  le reste du site) plutôt qu'un simple bouton "Déconnexion"
                  isolé — regroupe l'identité, le profil et la déconnexion
                  derrière l'avatar (cf. retour utilisateur). */
              }
              <details class="account-menu">
                <summary
                  class="account-menu__trigger"
                  aria-label="Menu du compte"
                >
                  <span class="account-menu__avatar" aria-hidden="true">
                    {initials(user.login)}
                  </span>
                </summary>
                <div class="account-menu__panel">
                  <div class="account-menu__identity">
                    <span
                      class="account-menu__avatar account-menu__avatar--large"
                      aria-hidden="true"
                    >
                      {initials(user.login)}
                    </span>
                    <span>
                      <span class="account-menu__login">{user.login}</span>
                      <span class="account-menu__email">{user.email}</span>
                    </span>
                  </div>

                  <a href="/profil" class="account-menu__item">
                    <UserIcon class="account-menu__item-icon" />
                    Gérer mon profil
                  </a>

                  <form
                    method="POST"
                    action="/deconnexion"
                    class="account-menu__form"
                  >
                    <button
                      type="submit"
                      class="account-menu__item account-menu__item--danger"
                    >
                      <LogoutIcon class="account-menu__item-icon" />
                      Déconnexion
                    </button>
                  </form>
                </div>
              </details>
            </nav>
          )
          : (
            <nav class="site-header__nav">
              <a href="/connexion" class="site-header__link">Connexion</a>
              <a
                href="/rejoindre"
                class="site-header__link site-header__link--primary"
              >
                Inscription
              </a>
            </nav>
          )}
      </div>
    </header>
  );
}
