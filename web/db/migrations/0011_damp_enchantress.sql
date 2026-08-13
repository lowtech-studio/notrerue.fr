CREATE TABLE "vouch" (
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_id" integer NOT NULL,
	"vouchee_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
-- Backfill : sans ça, tous les comptes déjà inscrits avant cette
-- fonctionnalité se retrouveraient "non vérifiés" au déploiement et
-- perdraient d'un coup le droit de publier/tapper/répondre/écrire (cf.
-- db/vouches.ts) — une régression pour des habitants déjà réels. Seuls les
-- comptes créés après cette migration démarrent réellement non vérifiés.
UPDATE "user" SET "verified_at" = "created_at" WHERE "verified_at" IS NULL;--> statement-breakpoint
ALTER TABLE "vouch" ADD CONSTRAINT "vouch_voucher_id_user_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouch" ADD CONSTRAINT "vouch_vouchee_id_user_id_fk" FOREIGN KEY ("vouchee_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vouch_voucher_vouchee_unique" ON "vouch" USING btree ("voucher_id","vouchee_id");--> statement-breakpoint
CREATE INDEX "vouch_vouchee_id_idx" ON "vouch" USING btree ("vouchee_id");