ALTER TABLE "user" ADD COLUMN "push_token" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "push_notifications_paused" boolean DEFAULT false NOT NULL;