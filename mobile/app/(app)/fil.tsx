import { PlaceholderScreen } from "../../components/PlaceholderScreen";

/** Cf. backlog mobile « fil unique et chronologique, filtrable par type »
 * — endpoint `/api/v1/posts` pas encore écrit côté serveur, cf.
 * _doc/architecture-mobile.md. */
export default function Fil() {
  return (
    <PlaceholderScreen
      title="Le fil de ma rue"
      subtitle="Publier et consulter les demandes de vos voisins arrive bientôt sur l'application."
    />
  );
}
