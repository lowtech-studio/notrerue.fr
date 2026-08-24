import { PlaceholderScreen } from "../../components/PlaceholderScreen";

/** Cf. web/routes/profil.tsx (gestion du compte, suppression) — pas
 * encore porté côté mobile ; la déconnexion, elle, est déjà disponible
 * dans le menu burger (cf. components/AppHeader.tsx). */
export default function Profil() {
  return (
    <PlaceholderScreen
      title="Mon profil"
      subtitle="La gestion de votre profil (numéro de bâtiment, suppression du compte...) arrive bientôt sur l'application."
    />
  );
}
