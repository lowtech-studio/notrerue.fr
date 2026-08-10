#!/usr/bin/env -S deno run -A
/**
 * Revue de code automatique du diff staged, via un LLM sur OpenRouter.
 * Appelé depuis .githooks/pre-commit, juste après `make check`.
 *
 * Comportement :
 * - Fail-open sur tout problème d'infra (clé absente, réseau, réponse
 *   inattendue) : on prévient et on laisse le commit passer.
 * - Fail-closed uniquement si le modèle rend explicitement un verdict
 *   "VERDICT: BLOQUANT" en fin de revue.
 * - `SKIP_AI_REVIEW=1 git commit ...` permet de sauter la revue (ex: urgence,
 *   pas de réseau). `git commit --no-verify` saute aussi `make check`.
 *
 * Trace écrite : chaque revue est aussi sauvegardée en Markdown dans
 * `_doc/reviews/` puis ajoutée à l'index (`git add`), donc embarquée dans le
 * commit en cours de création. Ça sert à la fois d'historique consultable
 * et de contexte que Claude Code peut relire (cf. AGENTS.md).
 */

const MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "moonshotai/kimi-k3";
const MAX_DIFF_CHARS = 60_000;
const MAX_FILE_CHARS = 20_000;

// Chemins exclus de la revue : générés, verrouillés, ou données brutes.
const EXCLUDE_PATHSPECS = [
  ":!web/deno.lock",
  ":!web/db/migrations/**",
  ":!web/db/seed/**",
  ":!**/_fresh/**",
  ":!**/*.lock",
  ":!**/_doc/reviews/**", // ":!_doc/..." échoue : git lit le "_" comme un caractère magique
  // Défense en profondeur : .env est gitignoré donc jamais staged en usage
  // normal, mais s'il l'était un jour (ex. `git add -f`), son contenu ne
  // doit pas partir vers OpenRouter.
  ":!**/.env",
];

const REVIEWS_DIR = "_doc/reviews";

async function run(cmd: string[], cwd: string): Promise<string> {
  const command = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  if (code !== 0) {
    throw new Error(
      `${cmd.join(" ")} a échoué: ${new TextDecoder().decode(stderr)}`,
    );
  }
  return new TextDecoder().decode(stdout);
}

function loadDotEnv(path: string) {
  let text: string;
  try {
    text = Deno.readTextFileSync(path);
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (Deno.env.get(key) === undefined) {
      Deno.env.set(key, value);
    }
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) +
    `\n[...tronqué, ${text.length - max} caractères en plus...]`;
}

/**
 * Sauvegarde la revue en Markdown dans `_doc/reviews/` et l'ajoute à l'index
 * git, pour qu'elle soit embarquée dans le commit en cours de création.
 *
 * Le hash du commit qui va être créé n'est pas encore connu à ce stade
 * (pre-commit tourne avant l'écriture de l'objet commit) : on identifie donc
 * la revue par son horodatage et le hash du commit *parent*.
 *
 * Le `git add` a lieu avant de savoir si le verdict est bloquant. En cas de
 * VERDICT: BLOQUANT (ou de commit abandonné après coup, ex. éditeur de
 * message fermé sans valider), le fichier reste stagé et sera embarqué dans
 * le prochain commit réussi — potentiellement pour un diff différent. C'est
 * accepté : c'est une trace de revue, pas une donnée sensible, et l'horodatage
 * + le commit parent qu'elle contient restent corrects.
 */
async function saveReview(
  root: string,
  opts: {
    model: string;
    files: string[];
    content: string;
    verdict: string | null;
  },
): Promise<void> {
  let parentSha = "initial";
  try {
    parentSha = (await run(["git", "rev-parse", "--short", "HEAD"], root))
      .trim();
  } catch {
    // Premier commit du dépôt : pas encore de HEAD.
  }

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const relPath = `${REVIEWS_DIR}/${stamp}_${parentSha}.md`;

  const header = [
    `# Revue IA — ${now.toISOString()}`,
    "",
    `- Modèle : ${opts.model}`,
    `- Commit parent : ${parentSha} (ce fichier fait partie du commit en cours de création, juste après ce parent)`,
    `- Fichiers revus : ${opts.files.join(", ")}`,
    `- Verdict : ${opts.verdict ?? "non détecté"}`,
    "",
    "---",
    "",
  ].join("\n");

  try {
    await Deno.mkdir(`${root}/${REVIEWS_DIR}`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/${relPath}`,
      header + opts.content.trim() + "\n",
    );
    await run(["git", "add", relPath], root);
    console.log(`📝 Revue enregistrée : ${relPath}`);
  } catch (err) {
    console.warn(
      `⚠️  Impossible d'enregistrer la revue dans ${relPath} : ${
        err instanceof Error ? err.message : err
      }`,
    );
  }
}

async function main() {
  if (Deno.env.get("SKIP_AI_REVIEW") === "1") {
    console.log("⏭️  Revue IA sautée (SKIP_AI_REVIEW=1).");
    return;
  }

  const root = (await run(["git", "rev-parse", "--show-toplevel"], ".")).trim();
  // OPENROUTER_API_KEY vit dans web/.env (voir son commentaire d'en-tête) ;
  // .env à la racine sert aux variables de compose.yaml (Brevo...). On
  // charge les deux ; leurs clés sont disjointes aujourd'hui, mais en cas de
  // doublon c'est le premier fichier chargé qui gagnerait (`loadDotEnv`
  // n'écrase jamais une variable déjà posée).
  loadDotEnv(`${root}/.env`);
  loadDotEnv(`${root}/web/.env`);

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    console.warn(
      "⚠️  OPENROUTER_API_KEY absente (.env ou env) : revue IA ignorée.",
    );
    return;
  }

  const filesRaw = await run(
    [
      "git",
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACMR",
      "--",
      ".",
      ...EXCLUDE_PATHSPECS,
    ],
    root,
  );
  const files = filesRaw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (files.length === 0) {
    console.log(
      "ℹ️  Rien à revoir (fichiers modifiés tous exclus ou aucun staged).",
    );
    return;
  }

  const diff = truncate(
    await run(
      ["git", "diff", "--cached", "--", ".", ...EXCLUDE_PATHSPECS],
      root,
    ),
    MAX_DIFF_CHARS,
  );

  const fileBlocks: string[] = [];
  for (const path of files) {
    let content: string;
    try {
      content = await run(["git", "show", `:${path}`], root);
    } catch {
      continue; // binaire ou illisible en texte : on saute le contenu complet
    }
    fileBlocks.push(
      `### ${path}\n\`\`\`\n${truncate(content, MAX_FILE_CHARS)}\n\`\`\``,
    );
  }

  const systemPrompt =
    `Tu es un relecteur de code senior pour "notrerue.fr", une appli Deno/Fresh/Preact + PostgreSQL (Drizzle) qui gère des données personnelles sensibles (nom, email, adresse de rue, session).
Fais une revue concise en français du diff staged fourni, en couvrant ces axes (uniquement ceux pertinents pour ce diff) :
- Bugs, régressions, gestion d'erreurs.
- Sécurité : injections, XSS, contrôle d'accès, fuite de données personnelles ou de secrets.
- Nommage : clarté et cohérence des noms de variables, fonctions, fichiers (identifiants en anglais, cf. AGENTS.md) ; signale les noms trompeurs, trop vagues ("data", "tmp", "x"...) ou incohérents avec le reste du code.
- Architecture : respect des règles Fresh (séparation routes/components/islands, pas de code serveur dans un island, props d'island sérialisables...), duplication évitable, complexité ou couplage excessifs, découpage des responsabilités.
Le formatage pur (indentation, espaces, points-virgules...) a déjà été vérifié par deno fmt/lint/check/test : ne relève pas ces nitpicks-là. Les remarques de nommage et d'architecture ci-dessus sont en revanche bienvenues même quand elles n'empêchent pas la compilation.
Regroupe les remarques par fichier, sois bref (pas de remarque = ne rien écrire pour ce fichier).
Termine IMPÉRATIVEMENT ta réponse par une dernière ligne exactement au format:
VERDICT: OK
ou
VERDICT: BLOQUANT
N'utilise BLOQUANT que pour un problème sérieux et certain (faille de sécurité, fuite de secret/donnée personnelle, perte de données, bug cassant manifeste). Nommage et architecture ne justifient jamais à eux seuls un BLOQUANT : dans le doute, ou pour de simples suggestions, utilise OK.`;

  const userPrompt =
    `Diff staged :\n\`\`\`diff\n${diff}\n\`\`\`\n\nContenu complet des fichiers modifiés (version staged) :\n${
      fileBlocks.join("\n\n")
    }`;

  console.log(`🤖 Revue IA (${MODEL}) sur ${files.length} fichier(s)...`);

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://notrerue.fr",
        "X-Title": "notrerue.fr pre-commit review",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
  } catch (err) {
    console.warn(
      `⚠️  Revue IA ignorée (réseau) : ${
        err instanceof Error ? err.message : err
      }`,
    );
    return;
  }

  if (!response.ok) {
    console.warn(
      `⚠️  Revue IA ignorée (HTTP ${response.status}) : ${await response
        .text()}`,
    );
    return;
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    console.warn(
      `⚠️  Revue IA ignorée (réponse illisible) : ${
        err instanceof Error ? err.message : err
      }`,
    );
    return;
  }

  // deno-lint-ignore no-explicit-any
  const content = (json as any)?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    console.warn("⚠️  Revue IA ignorée (réponse vide/inattendue).");
    return;
  }

  console.log("\n" + "─".repeat(60));
  console.log(content.trim());
  console.log("─".repeat(60) + "\n");

  const verdictMatch = content.match(/VERDICT:\s*(OK|BLOQUANT)\s*$/i);
  const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : null;

  await saveReview(root, { model: MODEL, files, content, verdict });

  if (!verdictMatch) {
    console.warn(
      "⚠️  Verdict non détecté dans la réponse : revue non bloquante.",
    );
    return;
  }

  if (verdict === "BLOQUANT") {
    console.error(
      "❌ Revue IA : problème bloquant détecté. Corrige-le, ou force avec " +
        "`SKIP_AI_REVIEW=1 git commit ...` / `git commit --no-verify`.",
    );
    Deno.exit(1);
  }

  console.log("✅ Revue IA : OK.");
}

main();
