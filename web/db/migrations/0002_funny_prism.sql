ALTER TABLE "street" DROP CONSTRAINT "street_name_city_unique";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "login_code_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "login_code_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "street_name_city_unique" ON "street" USING btree (lower("name"),"city_id");