import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) {
  throw new Error("DATABASE_URL n'est pas défini");
}

// Une seule instance (module-level singleton) réutilisée par tout le
// serveur — jamais une connexion par requête (cf. AGENTS.md « éco-conception »,
// RWEB0024). Bornée volontairement basse (`max: 5` par défaut, ajustable via
// `DATABASE_POOL_MAX`) : la cible de déploiement est un Raspberry Pi, où
// chaque connexion Postgres inactive coûte plusieurs Mo de RAM côté serveur
// — un pool large n'apporte rien pour le trafic d'une seule rue/ville et
// gaspille une mémoire déjà rare. `idle_timeout` referme les connexions
// inutilisées plutôt que de les garder ouvertes indéfiniment.
const poolMax = Number(Deno.env.get("DATABASE_POOL_MAX")) || 5;
const client = postgres(databaseUrl, {
  max: poolMax,
  idle_timeout: 20,
});

export const db = drizzle(client, { schema });
