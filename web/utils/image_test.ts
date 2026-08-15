import { assert, assertEquals, assertRejects } from "@std/assert";
import { Image } from "@cross/image";
import {
  MAX_IMAGE_DIMENSION,
  resizeAndEncodeImage,
  TARGET_IMAGE_BYTES,
  UnsupportedImageError,
} from "./image.ts";

const JPEG_MAGIC = [0xff, 0xd8];

/** Image RGBA de bruit aléatoire — pire cas pour un encodeur JPEG (quasi incompressible), utilisée pour forcer les passes de compression supplémentaires de `resizeAndEncodeImage`. */
function noisyPng(width: number, height: number): Promise<Uint8Array> {
  const data = new Uint8Array(width * height * 4);
  // `crypto.getRandomValues` refuse plus de 65536 octets par appel — rempli
  // par blocs plutôt qu'en un seul appel sur une image de plusieurs Mo.
  const CHUNK = 65536;
  for (let offset = 0; offset < data.length; offset += CHUNK) {
    crypto.getRandomValues(data.subarray(offset, offset + CHUNK));
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 255; // alpha opaque
  return Image.fromRGBA(width, height, data).encode("png");
}

Deno.test("resizeAndEncodeImage : image déjà sous la limite → dimensions inchangées, ré-encodée en JPEG", async () => {
  const source = await Image.create(100, 50, 255, 0, 0).encode("png");

  const result = await resizeAndEncodeImage(source);

  assertEquals(result.width, 100);
  assertEquals(result.height, 50);
  assertEquals([...result.data.slice(0, 2)], JPEG_MAGIC);
});

Deno.test("resizeAndEncodeImage : image trop grande → réduite en conservant le ratio, jamais agrandie", async () => {
  const source = await Image.create(2000, 1000, 0, 255, 0).encode("png");

  const result = await resizeAndEncodeImage(source);

  assertEquals(result.width, MAX_IMAGE_DIMENSION);
  assertEquals(result.height, MAX_IMAGE_DIMENSION / 2);
});

Deno.test("resizeAndEncodeImage : octets qui ne sont pas une image → UnsupportedImageError", async () => {
  const garbage = new Uint8Array([1, 2, 3, 4, 5]);

  await assertRejects(
    () => resizeAndEncodeImage(garbage),
    UnsupportedImageError,
  );
});

Deno.test("resizeAndEncodeImage : image carrée pile à la limite → inchangée", async () => {
  const size = MAX_IMAGE_DIMENSION;
  const source = await Image.create(size, size, 0, 0, 255).encode("png");

  const result = await resizeAndEncodeImage(source);

  assertEquals(result.width, size);
  assertEquals(result.height, size);
  assert(result.data.length > 0);
});

Deno.test("resizeAndEncodeImage : image unie sous la limite de dimension → un seul passage suffit, sous le poids visé", async () => {
  const source = await Image.create(1200, 800, 128, 64, 200).encode("png");

  const result = await resizeAndEncodeImage(source);

  assertEquals(result.width, 1200);
  assertEquals(result.height, 800);
  assert(result.data.length <= TARGET_IMAGE_BYTES);
});

Deno.test("resizeAndEncodeImage : image très détaillée (bruit) qui résiste à la qualité 80 → recompressée jusqu'à passer sous 500 Ko", async () => {
  const source = await noisyPng(1600, 900);

  const result = await resizeAndEncodeImage(source);

  assert(
    result.data.length <= TARGET_IMAGE_BYTES,
    `attendu ≤ ${TARGET_IMAGE_BYTES} octets, obtenu ${result.data.length}`,
  );
  // La réduction de dimension supplémentaire (au-delà de MAX_IMAGE_DIMENSION)
  // n'intervient que si baisser la qualité n'a pas suffi : les deux leviers
  // ont dû être utilisés vu à quel point du bruit résiste à la compression.
  assert(result.width < MAX_IMAGE_DIMENSION || result.height < 900);
});

Deno.test("resizeAndEncodeImage : jamais agrandie même si le résultat compressé dépasse toujours 500 Ko", async () => {
  // Bruit à une taille déjà réduite (sous MAX_IMAGE_DIMENSION) : même en
  // épuisant qualité et essais de réduction, la taille de sortie ne doit
  // jamais dépasser la taille d'origine.
  const source = await noisyPng(400, 300);

  const result = await resizeAndEncodeImage(source);

  assert(result.width <= 400);
  assert(result.height <= 300);
});
