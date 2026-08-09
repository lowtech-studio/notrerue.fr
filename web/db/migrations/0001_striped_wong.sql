ALTER TABLE "house" ALTER COLUMN "number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "city" ADD COLUMN "insee_code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "city" ADD COLUMN "postal_codes" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "city" ADD COLUMN "department" text NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "login_code" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "login_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_ambassador" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "city_name_idx" ON "city" USING btree ("name");--> statement-breakpoint
ALTER TABLE "city" ADD CONSTRAINT "city_insee_code_unique" UNIQUE("insee_code");--> statement-breakpoint
ALTER TABLE "street" ADD CONSTRAINT "street_name_city_unique" UNIQUE("name","city_id");