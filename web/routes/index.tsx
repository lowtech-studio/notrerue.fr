import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { Header } from "../components/Header.tsx";

const MAX_RUE_LENGTH = 80;

interface HomeData {
  rue: string;
}

export const handler = define.handlers({
  GET(ctx) {
    const raw = ctx.url.searchParams.get("rue") ?? "";
    const rue = raw.trim().slice(0, MAX_RUE_LENGTH);
    return { data: { rue } };
  },
});

export default define.page<typeof handler>(function Home({ data }) {
  const { rue } = data as HomeData;

  return (
    <>
      <Head>
        <title>NotreRue.fr — Créer du lien entre voisins</title>
      </Head>
      <Header />
      <main>
        <section class="container hero" id="trouver-ma-rue">
          <div>
            <p class="hero__eyebrow">Créer du lien entre voisins</p>
            <h1 class="hero__title">
              Retrouvez vos voisins.
            </h1>
            <p class="hero__subtitle">
              NotreRue.fr aide les habitants d'une même rue à se rapprocher :
              partage, entraide, troc et sécurité collective.
              Une page privée, réservée aux gens qui vivent dans notre rue.
            </p>

            {rue !== "" && (
              <p class="hero__confirmation">
                Merci ! Nous avons bien noté la rue{" "}
                <strong>{rue}</strong>. Dès que d'autres habitants la
                rejoignent, sa page s'active.
              </p>
            )}

            <div class="lookup-card">
              <form class="lookup-form" method="GET">
                <label class="lookup-card__label" for="rue">
                  Nom de votre rue
                </label>
                <input
                  id="rue"
                  name="rue"
                  type="text"
                  class="lookup-form__input"
                  placeholder="Rue des Lilas, Nantes"
                  maxlength={MAX_RUE_LENGTH}
                  value={rue}
                  autocomplete="off"
                  required
                />
                <button type="submit" class="button">
                  Trouver ma rue
                </button>
              </form>
            </div>
            <p class="hero__note">
              Gratuit · sans publicité · réservé aux habitants de la rue
            </p>
          </div>

          <aside class="trust-card" id="confidentialite">
            <h2 class="trust-card__title">
              Ce que vous ne verrez jamais ici
            </h2>
            <ul class="trust-card__list">
              <li>Votre nom de famille, votre adresse exacte, votre âge</li>
              <li>Le contenu d'une rue, si vous n'y habitez pas</li>
              <li>Vos données revendues à des tiers ou stockées en dehors de France</li>
            </ul>
          </aside>
        </section>
      </main>
      <footer class="site-footer">
        <p class="container site-footer__text">
          NotreRue.fr — « Nous rapprocher les uns des autres »
        </p>
      </footer>
    </>
  );
});
