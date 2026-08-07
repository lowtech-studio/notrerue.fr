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
];

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

function loadDotEnv(root: string) {
  let text: string;
  try {
    text = Deno.readTextFileSync(`${root}/.env`);
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
  return text.slice(0, max) + `\n[...tronqué, ${text.length - max} caractères en plus...]`;
}

async function main() {
  if (Deno.env.get("SKIP_AI_REVIEW") === "1") {
    console.log("⏭️  Revue IA sautée (SKIP_AI_REVIEW=1).");
    return;
  }

  const root = (await run(["git", "rev-parse", "--show-toplevel"], ".")).trim();
  loadDotEnv(root);

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    console.warn(
      "⚠️  OPENROUTER_API_KEY absente (.env ou env) : revue IA ignorée.",
    );
    return;
  }

  const filesRaw = await run(
    ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "--", ".", ...EXCLUDE_PATHSPECS],
    root,
  );
  const files = filesRaw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (files.length === 0) {
    console.log("ℹ️  Rien à revoir (fichiers modifiés tous exclus ou aucun staged).");
    return;
  }

  const diff = truncate(
    await run(["git", "diff", "--cached", "--", ".", ...EXCLUDE_PATHSPECS], root),
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

  const systemPrompt = `Tu es un relecteur de code senior pour "notrerue.fr", une appli Deno/Fresh/Preact + PostgreSQL (Drizzle) qui gère des données personnelles sensibles (nom, email, adresse de rue, session).
Fais une revue concise en français du diff staged fourni (bugs, sécurité — injections, XSS, contrôle d'accès, fuite de données personnelles ou de secrets —, régressions, gestion d'erreurs). Le style/format a déjà été vérifié par deno fmt/lint/check/test : ne relève pas de nitpicks de style.
Regroupe les remarques par fichier, sois bref (pas de remarque = ne rien écrire pour ce fichier).
Termine IMPÉRATIVEMENT ta réponse par une dernière ligne exactement au format:
VERDICT: OK
ou
VERDICT: BLOQUANT
N'utilise BLOQUANT que pour un problème sérieux et certain (faille de sécurité, fuite de secret/donnée personnelle, perte de données, bug cassant manifeste). Dans le doute, ou pour de simples suggestions, utilise OK.`;

  const userPrompt = `Diff staged :\n\`\`\`diff\n${diff}\n\`\`\`\n\nContenu complet des fichiers modifiés (version staged) :\n${
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
    console.warn(`⚠️  Revue IA ignorée (réseau) : ${err instanceof Error ? err.message : err}`);
    return;
  }

  if (!response.ok) {
    console.warn(`⚠️  Revue IA ignorée (HTTP ${response.status}) : ${await response.text()}`);
    return;
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    console.warn(`⚠️  Revue IA ignorée (réponse illisible) : ${err instanceof Error ? err.message : err}`);
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
  if (!verdictMatch) {
    console.warn("⚠️  Verdict non détecté dans la réponse : revue non bloquante.");
    return;
  }

  if (verdictMatch[1].toUpperCase() === "BLOQUANT") {
    console.error(
      "❌ Revue IA : problème bloquant détecté. Corrige-le, ou force avec " +
        "`SKIP_AI_REVIEW=1 git commit ...` / `git commit --no-verify`.",
    );
    Deno.exit(1);
  }

  console.log("✅ Revue IA : OK.");
}

main();
