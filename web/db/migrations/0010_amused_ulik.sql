CREATE INDEX "comment_post_id_idx" ON "comment" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "comment_user_id_idx" ON "comment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "house_street_id_idx" ON "house" USING btree ("street_id");--> statement-breakpoint
CREATE INDEX "message_user_from_id_idx" ON "message" USING btree ("user_from_id");--> statement-breakpoint
CREATE INDEX "message_user_to_id_idx" ON "message" USING btree ("user_to_id");--> statement-breakpoint
CREATE INDEX "message_unread_idx" ON "message" USING btree ("user_to_id") WHERE "message"."read_at" IS NULL AND "message"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "post_user_id_idx" ON "post" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tap_post_id_idx" ON "tap" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "user_house_id_idx" ON "user" USING btree ("house_id");