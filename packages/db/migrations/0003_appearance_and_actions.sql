ALTER TABLE "bots" ADD COLUMN "appearance" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "actions" jsonb DEFAULT '[]'::jsonb NOT NULL;