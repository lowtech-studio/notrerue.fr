import type { SessionUser } from "../utils.ts";

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
                  <a href="/messages" class="site-header__link">
                    Mes messages
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
              <form
                method="POST"
                action="/deconnexion"
                class="site-header__form"
              >
                <button type="submit" class="site-header__link">
                  Déconnexion
                </button>
              </form>
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
