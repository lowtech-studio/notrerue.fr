import { PlaceholderScreen } from "../../components/PlaceholderScreen";

/** Cf. backlog mobile « messagerie privée + notification push » — endpoint
 * `/api/v1/messages` pas encore écrit côté serveur. */
export default function Messages() {
  return (
    <PlaceholderScreen
      title="Mes messages"
      subtitle="La messagerie privée avec vos voisins arrive bientôt sur l'application."
    />
  );
}
