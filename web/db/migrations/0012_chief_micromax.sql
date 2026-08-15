CREATE TABLE "post_image" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"street_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_image_post_id_unique" UNIQUE("post_id")
);
--> statement-breakpoint
ALTER TABLE "post_image" ADD CONSTRAINT "post_image_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_image" ADD CONSTRAINT "post_image_street_id_street_id_fk" FOREIGN KEY ("street_id") REFERENCES "public"."street"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_image_street_id_idx" ON "post_image" USING btree ("street_id");