import { Image } from "@cross/image";

/**
 * Poids maximal accepté pour un fichier envoyé par l'utilisateur, avant
 * tout traitement (cf. backlog « la taille maximum d'un fichier doit être
 * fixée à 5 Mo »). Vérifié par l'appelant (routes/fil.tsx) avant même de
 * lire les octets en mémoire — inutile de décoder une image trop lourde
 * pour la rejeter ensuite.
 */
export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Plus grande dimension (largeur ou hauteur) conservée après redimension-
 * nement — suffisant pour un affichage dans le fil, jamais destiné à être
 * zoomé en plein écran (cf. AGENTS.md « redimensionnée côté serveur à la
 * taille d'affichage réelle »). Première étape de compression : une photo
 * de téléphone (souvent 3000-4000px de large) tombe déjà de plusieurs Mo à
 * quelques centaines de Ko rien qu'avec ce redimensionnement.
 */
export const MAX_IMAGE_DIMENSION = 1600;

/**
 * Poids final visé après compression (cf. backlog « réduire sa taille sous
 * les 500 Ko même si l'utilisateur envoie un fichier de plus de 500 Ko »).
 * Le redimensionnement à `MAX_IMAGE_DIMENSION` suffit à l'atteindre pour
 * l'immense majorité des photos ; `resizeAndEncodeImage` ne recompresse
 * davantage (qualité, puis dimensions) que si ce n'est pas le cas — jamais
 * de garantie stricte (une image très détaillée pourrait rester
 * légèrement au-dessus même au plancher de qualité/taille ci-dessous),
 * mais toujours le meilleur résultat atteint dans ce budget d'essais.
 */
export const TARGET_IMAGE_BYTES = 500 * 1024;

/**
 * Qualités JPEG essayées dans l'ordre jusqu'à passer sous
 * `TARGET_IMAGE_BYTES` — la première (78) est un compromis poids/lisibilité
 * pour des photos de sujets courants (objet à prêter, dégât à montrer...),
 * la seconde ne sert qu'à rattraper les images qui résistent encore à
 * cette qualité (dégradation visible acceptée en dernier recours, plutôt
 * que de dépasser l'objectif de poids). Volontairement courte (pas de
 * palier intermédiaire) : chaque encodage a un coût CPU réel — mesuré à
 * plusieurs secondes sur une image très détaillée en 1600px — et ce serveur
 * tourne sur un VPS à 1 vCore partagé avec le reste du trafic (cf.
 * MAX_DOWNSCALE_ROUNDS ci-dessous pour le même arbitrage).
 */
const JPEG_QUALITY_STEPS = [78, 45];

/**
 * Si aucune qualité de `JPEG_QUALITY_STEPS` ne suffit à passer sous
 * `TARGET_IMAGE_BYTES` (image très détaillée/bruitée), on réduit encore les
 * dimensions par ce facteur et on retente toutes les qualités — jusqu'à ce
 * nombre de fois. Borné à 1 seul essai supplémentaire : chaque round coûte
 * un redimensionnement + jusqu'à `JPEG_QUALITY_STEPS.length` encodages, et
 * ce traitement bloque le thread JS unique de Deno pendant son exécution
 * (pas de worker dédié) — un budget trop large dégraderait la réactivité
 * du serveur pour tous les autres visiteurs le temps d'un unique upload
 * pathologique. Les photos réelles (même chargées) passent la première
 * qualité dès le premier essai ; ce plafond ne concerne que les cas
 * volontairement adverses (cf. tests avec du bruit aléatoire).
 */
const MAX_DOWNSCALE_ROUNDS = 1;
const DOWNSCALE_FACTOR = 0.7;

export interface ResizedImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Levée quand les octets fournis ne sont pas une image dans un format décodable (cf. `Image.decode` de `@cross/image` : PNG/APNG/JPEG/WebP/GIF/TIFF/BMP/ICO... — pas le HEIC par défaut de l'appareil photo iPhone, à convertir en JPEG avant envoi le cas échéant). */
export class UnsupportedImageError extends Error {
  constructor() {
    super("Format d'image non reconnu.");
    this.name = "UnsupportedImageError";
  }
}

function resizeToFit(image: Image, maxDimension: number): void {
  const { width, height } = image;
  const scale = Math.min(1, maxDimension / width, maxDimension / height);
  if (scale >= 1) return;
  scaleImage(image, scale);
}

/**
 * Réduit `image` d'un facteur uniforme (< 1), appliqué identiquement à la
 * largeur et à la hauteur quelle que soit l'orientation — contrairement à
 * `resizeToFit`, qui borne la plus grande dimension et n'est donc pas
 * réutilisable telle quelle pour « rétrécir encore de x % » (une image
 * portrait s'en trouverait réduite bien plus que `factor`).
 */
function scaleImage(image: Image, factor: number): void {
  const { width, height } = image;
  // Dimensions calculées ici (plutôt que confiées à l'option `fit` de
  // `resize`) pour obtenir directement la taille finale, sans
  // letterboxing/recadrage : `fit` ajouterait un cadre transparent ou
  // rognerait l'image pour remplir exactement une boîte width×height, ce
  // qu'on ne veut pas — juste réduire proportionnellement.
  image.resize({
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  });
}

/**
 * Décode une image, la réduit si besoin (aspect ratio conservé, jamais
 * agrandie) et la ré-encode systématiquement en JPEG — un seul format à
 * stocker/servir, et les métadonnées (EXIF, position GPS...) du fichier
 * d'origine ne sont jamais conservées (cf. schema.ts#postImage).
 *
 * Deux leviers de compression, dans cet ordre (cf. backlog) : d'abord la
 * limite de dimension (`MAX_IMAGE_DIMENSION`, quasi gratuite — un seul
 * redimensionnement) : suffisante dans l'immense majorité des cas. Si le
 * résultat dépasse encore `TARGET_IMAGE_BYTES`, une qualité JPEG plus
 * agressive est essayée, puis si besoin une réduction de dimension
 * supplémentaire — jamais l'inverse, pour ne payer le coût des passes
 * suivantes que pour les images qui en ont vraiment besoin.
 */
export async function resizeAndEncodeImage(
  bytes: Uint8Array,
): Promise<ResizedImage> {
  let image: Image;
  try {
    image = await Image.decode(bytes);
  } catch {
    throw new UnsupportedImageError();
  }

  resizeToFit(image, MAX_IMAGE_DIMENSION);

  let best: ResizedImage | null = null;
  for (let round = 0; round <= MAX_DOWNSCALE_ROUNDS; round++) {
    for (const quality of JPEG_QUALITY_STEPS) {
      const data = await image.encode("jpeg", { quality });
      if (!best || data.length < best.data.length) {
        best = { data, width: image.width, height: image.height };
      }
      if (data.length <= TARGET_IMAGE_BYTES) return best;
    }
    if (round < MAX_DOWNSCALE_ROUNDS) {
      scaleImage(image, DOWNSCALE_FACTOR);
    }
  }

  // Aucun essai n'est passé sous TARGET_IMAGE_BYTES (image très détaillée/
  // bruitée) : on rend le meilleur (le plus léger) obtenu plutôt que
  // d'échouer l'envoi pour ça — cf. commentaire sur TARGET_IMAGE_BYTES.
  return best!;
}
