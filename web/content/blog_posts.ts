/**
 * Articles du blog (cf. routes/blog/) — contenu éditorial 100% statique,
 * rédigé une fois pour toutes, pas de CMS ni de table en base pour un aussi
 * petit volume (cf. AGENTS.md éco-conception : pas d'infra superflue pour
 * quelques pages). Même logique que `FAQ_ITEMS` dans routes/index.tsx.
 *
 * `intro` porte la réponse directe en 2-3 phrases (format « AEO » recommandé
 * par l'audit SEO/visibilité IA) : ce qu'un moteur — classique ou
 * conversationnel — peut citer seul, avant même de lire `body`.
 */
export interface BlogPost {
  slug: string;
  title: string;
  /** Résumé affiché sur /blog et repris comme `<meta name="description">` de l'article. */
  description: string;
  /** Date de publication, format ISO (jour près) — ex. "2026-08-15". */
  publishedAt: string;
  intro: string;
  /** Paragraphes du corps, dans l'ordre d'affichage. */
  body: string[];
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "whatsapp-groupe-de-quartier",
    title: "NotreRue.fr ou groupe WhatsApp de quartier : quelle différence ?",
    description:
      "Un groupe WhatsApp de quartier fonctionne bien tant qu'il reste petit. Ce qui change avec NotreRue.fr : des voisins vérifiés, trois catégories claires, et rien d'autre à faire défiler.",
    publishedAt: "2026-08-15",
    intro:
      "Un groupe WhatsApp de quartier grossit sans limite, mélange tout (annonces, débats, blagues) et n'est accessible qu'à qui connaît déjà quelqu'un dedans. NotreRue.fr réserve chaque rue à ses habitants vérifiés, avec trois catégories claires — Je cherche, Je propose, J'informe — et rien d'autre à faire défiler.",
    body: [
      "Un groupe WhatsApp fonctionne bien tant qu'il reste petit. Passé une trentaine de membres, il devient vite difficile à suivre : les annonces utiles se noient dans les conversations, on hésite à y écrire pour ne pas déranger tout le monde, et il n'existe aucun moyen de vérifier qu'un nouveau membre habite vraiment la rue — il suffit d'avoir le lien d'invitation, transmis de main en main.",
      "NotreRue.fr part du même besoin — s'entraider entre voisins — mais structure l'échange autrement. Chaque nouvel habitant est confirmé par un voisin déjà inscrit avant de pouvoir publier ou écrire à quelqu'un. Une demande se range dans l'une de trois catégories, pas plus : « Je cherche » (une perceuse, un plombier fiable), « Je propose » (je prête ma tondeuse ce week-end) ou « J'informe » (coupure d'eau prévue mardi matin).",
      "L'historique reste consultable : une question déjà posée — et déjà répondue par un voisin — ne se reperd pas dans un fil de discussion qui défile. Le prochain habitant à se demander « qui a un bon plombier dans la rue ? » retrouve la réponse sans avoir à la reposer.",
      "Aucune coordonnée personnelle n'est visible tant qu'on n'engage pas soi-même la conversation : pas de numéro de téléphone partagé à toute la rue par défaut, une messagerie privée pour aller plus loin une fois le contact établi.",
      "Ce n'est pas un réseau social de plus à alimenter : pas de fil infini, pas de publicité ciblée sur vos données, pas de revente à des tiers. Juste de quoi se rendre service entre gens qui habitent vraiment la même rue.",
    ],
  },
  {
    slug: "trouver-artisan-confiance-quartier",
    title:
      "Trouver un artisan de confiance dans son quartier, sans avis anonymes",
    description:
      "Les avis en ligne se manipulent et s'achètent. La recommandation la plus fiable reste celle d'un voisin qui a vraiment fait appel à cet artisan — et qu'on croisera à nouveau s'il s'est trompé.",
    publishedAt: "2026-07-15",
    intro:
      "Les avis anonymes en ligne se manipulent : de faux commentaires, des notes achetées, aucun moyen de vérifier qui a vraiment fait appel à ce plombier ou cet électricien. La recommandation la plus fiable reste celle d'un vrai voisin, qui a vraiment utilisé ce service — et qu'on recroisera dans la rue s'il s'est trompé.",
    body: [
      "Chercher « plombier » ou « électricien » sur un moteur de recherche renvoie des dizaines de fiches truffées d'avis à 5 étoiles, sans qu'il soit possible de savoir lesquels sont sincères. Certains sont achetés, d'autres postés par l'entreprise elle-même sous un faux compte — le phénomène est documenté depuis des années et n'a pas de solution miracle côté plateformes d'avis classiques.",
      "Une recommandation de voisin fonctionne différemment : la personne qui la donne a réellement fait appel à cet artisan, pour un vrai chantier, dans une rue qu'elle habite vraiment. Elle n'a aucune raison de mentir à quelqu'un qu'elle recroisera au quotidien — l'inverse de l'anonymat d'un avis en ligne.",
      "Sur NotreRue.fr, ça prend la forme d'une demande « Je cherche » — « Un plombier fiable pour une fuite ? », par exemple — à laquelle les voisins répondent publiquement, en une phrase : un nom, une entreprise, une raison de faire confiance. Pas un roman, juste de quoi décider.",
      "Ces réponses restent visibles pour la prochaine personne qui posera la même question, sans avoir à la reposer. Un fil de discussion WhatsApp fait remonter la réponse une fois puis l'enterre sous les messages suivants ; ici, elle reste à sa place, associée à la question.",
      "Le principe s'applique à n'importe quel besoin de confiance locale — un médecin qui prend encore des nouveaux patients, un professeur particulier, une baby-sitter — pas seulement aux artisans du bâtiment.",
    ],
  },
  {
    slug: "preter-materiel-entre-voisins",
    title: "Prêter et emprunter du matériel entre voisins, en toute sécurité",
    description:
      "Une perceuse qui sert deux fois par an, une échelle qui prend la poussière au garage : emprunter à un voisin plutôt qu'acheter, sans les inconvénients d'un rendez-vous avec un inconnu trouvé en ligne.",
    publishedAt: "2026-06-15",
    intro:
      "Une perceuse, une échelle, un nettoyeur haute pression : la plupart de l'outillage sert quelques fois par an et prend la poussière le reste du temps. Emprunter à un voisin évite l'achat inutile — sans le rendez-vous avec un inconnu trouvé sur une petite annonce en ligne.",
    body: [
      "Beaucoup d'objets ne justifient pas leur achat : un appareil à raclette utilisé une fois par hiver, une perceuse à percussion pour poser trois étagères, une remorque pour un déménagement ponctuel. Les racheter neufs coûte cher et finit par encombrer un garage ; les emprunter à quelqu'un qui les a déjà résout le problème sans dépense.",
      "Les plateformes de petites annonces entre particuliers marchent, mais impliquent de fixer un rendez-vous avec un inconnu, parfois loin de chez soi, sans savoir à qui on a vraiment affaire. Emprunter à un voisin change la donne : la personne habite la même rue, on sait où la retrouver, et la confiance ne repose pas sur un profil anonyme.",
      "Sur NotreRue.fr, ça se formule en une phrase, dans l'une des deux catégories concernées : « Je cherche » pour demander (« Je cherche une perceuse ce week-end »), « Je propose » pour offrir (« Je prête ma tondeuse ce week-end »). Les voisins intéressés manifestent leur intérêt en un geste, puis la messagerie privée prend le relais pour s'organiser — heure, lieu, durée.",
      "Quelques réflexes simples évitent les mauvaises surprises, prêteur comme emprunteur : convenir d'une date de retour dès l'échange, vérifier ensemble l'état de l'objet en le récupérant, et rendre le service à son tour quand l'occasion se présente — c'est ce qui fait tenir l'entraide dans la durée, pas un règlement.",
    ],
  },
  {
    slug: "garder-animal-vacances-voisins",
    title: "Qui peut garder mon chien le temps d'un week-end ?",
    description:
      "Pas envie de payer une pension pour deux jours d'absence ? Un voisin qui croise déjà votre chien en promenade est souvent la solution la plus simple — et la plus rassurante pour l'animal.",
    publishedAt: "2026-05-15",
    intro:
      "Partir un week-end sans savoir qui s'occupera du chien ou du chat retient beaucoup de monde à la maison. Un voisin qui connaît déjà l'animal et habite à deux pas est souvent plus rassurant qu'une pension inconnue — et gratuit.",
    body: [
      "Une pension coûte cher et impose de déposer l'animal dans un environnement qu'il ne connaît pas. Un voisin qui vient nourrir le chat ou promener le chien dans son cadre habituel change beaucoup de choses, pour l'animal comme pour son propriétaire.",
      "Une publication « Je cherche » — « Qui peut garder mon chien le week-end du 20 ? » — suffit pour savoir si quelqu'un dans la rue est partant. Croquettes, clés, promenades : les détails se règlent ensuite directement, par message privé.",
    ],
  },
  {
    slug: "panne-fibre-internet-rue",
    title: "Panne internet : c'est chez moi, ou toute la rue est touchée ?",
    description:
      "Avant d'attendre au téléphone avec un service client, un message à ses voisins suffit souvent à savoir si le problème vient de chez soi ou du quartier entier.",
    publishedAt: "2026-04-15",
    intro:
      "Avant d'attendre une demi-heure au téléphone avec un service client, il suffit souvent de savoir une chose : ça coupe aussi chez le voisin ? Si oui, inutile de réinitialiser sa box pendant une heure — c'est un problème de réseau, pas chez soi.",
    body: [
      "Une box qui clignote donne rarement d'indice sur l'origine du problème, et un fournisseur d'accès met parfois des heures à signaler une panne sur sa carte de couverture — largement après que le quartier l'a déjà remarquée de son côté.",
      "Une publication « J'informe » — « Coupure fibre depuis 14h, quelqu'un d'autre est touché ? » — permet de savoir en quelques minutes si le problème est isolé ou partagé, et d'échanger le bon interlocuteur si un voisin l'a déjà eu au téléphone.",
    ],
  },
  {
    slug: "signaler-vitesse-excessive-rue",
    title:
      "On roule trop vite dans ma rue : comment se faire entendre à plusieurs ?",
    description:
      "Un signalement isolé à la mairie pèse peu. Découvrir que plusieurs voisins partagent la même inquiétude, et la porter ensemble, change la donne.",
    publishedAt: "2026-03-15",
    intro:
      "Un habitant qui signale seul une vitesse excessive à sa mairie obtient rarement une réponse rapide. Découvrir que trois, cinq ou dix voisins partagent la même inquiétude — et le dire ensemble — pèse nettement plus lourd.",
    body: [
      "NotreRue.fr ne transmet rien automatiquement à la mairie (cette fonctionnalité n'existe pas à ce jour) : ce qu'il permet, c'est de savoir qui, dans la rue, partage la même préoccupation, pour se coordonner ensuite.",
      "Une publication « Je cherche » — « Qui d'autre trouve qu'on roule trop vite devant l'école ? » — fait souvent remonter des voisins qui pensaient être seuls à s'en inquiéter. À plusieurs, une demande de ralentisseur ou de radar pédagogique pèse bien plus lourd.",
    ],
  },
  {
    slug: "covoiturage-entre-voisins",
    title:
      "Covoiturage entre voisins : partager le trajet de l'école ou de la gare",
    description:
      "Le même trajet, matin et soir, souvent fait par plusieurs foyers d'une même rue sans le savoir. Le dire suffit parfois à économiser essence, trajets et temps.",
    publishedAt: "2026-02-15",
    intro:
      "Deux ou trois foyers d'une même rue déposent parfois leurs enfants à la même école, ou prennent le même train chaque matin, sans jamais se croiser dans leur voiture. Le savoir suffit souvent à organiser un trajet partagé.",
    body: [
      "Économie d'essence, moins de trajets, un peu de compagnie le matin : le covoiturage de proximité coche beaucoup de cases, mais suppose de savoir qui fait le même trajet — ce qu'un quartier n'a souvent aucun moyen simple de découvrir.",
      "Une publication « Je cherche » — « Quelqu'un dépose ses enfants à l'école du quartier vers 8h15 ? » — suffit à lancer la conversation. Jours, horaires, participation aux frais : les détails se règlent ensuite en message privé, entre les personnes concernées.",
    ],
  },
  {
    slug: "garde-enfants-depannage-voisins",
    title:
      "Un imprévu, personne pour garder les enfants : les voisins peuvent aider",
    description:
      "Une réunion qui déborde, une baby-sitter qui annule au dernier moment : un voisin de confiance, déjà croisé à l'école, dépanne souvent plus vite qu'une appli de baby-sitting classique.",
    publishedAt: "2026-01-15",
    intro:
      "Une réunion qui s'éternise, une baby-sitter qui se décommande à la dernière minute : trouver une solution en urgence est un vrai casse-tête. Un voisin déjà croisé à la sortie de l'école, vérifié comme habitant réellement la rue, dépanne souvent plus vite qu'une recherche sur une application classique.",
    body: [
      "NotreRue.fr n'est pas une plateforme de baby-sitting avec profils, notes ou paiement intégré : c'est un moyen de savoir qui, dans la rue, serait disponible et partant — la confiance et les modalités se construisent ensuite, comme pour n'importe quel service entre voisins.",
      "Seuls les habitants d'au moins 15 ans peuvent s'inscrire et publier (seuil légal du consentement numérique) : la demande s'adresse donc aux adultes et grands adolescents de la rue, pas aux enfants eux-mêmes.",
    ],
  },
  {
    slug: "echanger-reparer-objets-entre-voisins",
    title:
      "Réparer plutôt que jeter : mutualiser les objets et les compétences entre voisins",
    description:
      "Une machine à coudre qui dort dans un placard peut réparer l'ourlet de quelqu'un d'autre ; un voisin bricoleur peut sauver un grille-pain que personne n'osait jeter.",
    publishedAt: "2025-12-15",
    intro:
      "Une perceuse qui sert deux fois par an est un bon exemple de mutualisation, mais le principe va plus loin : un voisin sait souvent réparer ce qu'on s'apprêtait à jeter, ou possède l'objet qui rendrait un achat neuf inutile.",
    body: [
      "Machine à coudre, outillage électroportatif, compétences en bricolage ou en couture : ce qui prend la poussière chez l'un peut resservir chez l'autre, et ce que l'un sait réparer évite un achat neuf à l'autre — dans les deux sens, sans dépense.",
      "Une publication « Je propose » (« Je sais réparer les petits appareils électroménagers, demandez si besoin ») ou « Je cherche » (« Quelqu'un a une surjeteuse à me prêter une heure ? ») suffit à lancer l'échange.",
    ],
  },
  {
    slug: "rompre-isolement-voisinage",
    title:
      "Rompre l'isolement : un service du quotidien peut suffire à créer du lien",
    description:
      "Monter les courses d'un voisin âgé, prendre des nouvelles, prévenir en cas d'absence prolongée : le lien de voisinage se construit souvent à partir de petits gestes concrets.",
    publishedAt: "2025-11-15",
    intro:
      "L'isolement ne se résout pas avec une seule solution, mais des petits gestes concrets y contribuent : monter des courses, passer prendre des nouvelles, ou simplement savoir qu'un voisin est joignable en cas de besoin.",
    body: [
      "Beaucoup de personnes isolées ne connaissent aucun de leurs voisins par leur prénom — pas par manque de volonté, mais parce que l'occasion ne se présente jamais naturellement. Une plateforme dédiée à la rue crée cette occasion, sans avoir à sonner à une porte au hasard.",
      "Une publication « Je propose » (« Je descends faire des courses tous les jeudis, dites-moi si vous avez besoin de quelque chose ») ou « J'informe » (« Je pars trois semaines, prévenez-moi si quelque chose semble anormal ») suffit à amorcer ce lien.",
    ],
  },
  {
    slug: "veiller-maison-absence-vacances",
    title:
      "Partir en vacances l'esprit tranquille : faire veiller sa maison par un voisin",
    description:
      "Relever le courrier, arroser les plantes, fermer les volets le soir : un voisin qui passe régulièrement rend une maison bien moins repérable comme vide, pour beaucoup moins cher qu'un service de gardiennage.",
    publishedAt: "2025-10-15",
    intro:
      "Une boîte aux lettres qui déborde ou des volets toujours fermés signalent une maison vide. Un voisin qui passe relever le courrier et ouvrir les volets change cette impression, sans frais ni matériel.",
    body: [
      "Le principe est simple mais rarement mis en pratique, faute d'avoir quelqu'un à qui le demander naturellement : relever le courrier, arroser deux ou trois plantes, sortir les poubelles au bon jour, ou juste garder un œil pendant une absence prolongée.",
      "Une publication « Je cherche » avant de partir — « Je pars 10 jours, quelqu'un peut passer relever le courrier ? » — suffit à trouver preneur, et à rendre le service à son tour la prochaine fois que ce sera un voisin qui s'absente.",
    ],
  },
];

/** `null` si aucun article ne correspond (cf. routes/blog/[slug].tsx, 404). */
export function findBlogPostBySlug(slug: string): BlogPost | null {
  return BLOG_POSTS.find((post) => post.slug === slug) ?? null;
}

/** Du plus récent au plus ancien, pour l'ordre d'affichage sur /blog. */
export function listBlogPostsSortedByDate(): BlogPost[] {
  return [...BLOG_POSTS].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt)
  );
}

/**
 * Date absolue en français ("15 août 2026"), pas relative
 * (utils/relative_date.ts) : un article de blog reste pertinent des mois
 * après sa publication, contrairement à une demande sur /fil — "il y a 3
 * mois" y serait moins utile qu'une vraie date.
 */
export function formatBlogDate(publishedAt: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(
    new Date(`${publishedAt}T00:00:00Z`),
  );
}
