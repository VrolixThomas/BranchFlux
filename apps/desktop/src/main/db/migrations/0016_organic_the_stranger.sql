CREATE TABLE `resolution_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text,
	`session_id` text NOT NULL,
	`platform_comment_id` text NOT NULL,
	`platform_thread_id` text,
	`file_path` text,
	`line_number` integer,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`skip_reason` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `resolution_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `resolution_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `resolution_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`commit_sha` text NOT NULL,
	`commit_message` text NOT NULL,
	`status` text DEFAULT 'applied' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `resolution_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `resolution_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`pr_provider` text NOT NULL,
	`pr_identifier` text NOT NULL,
	`commit_sha_before` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `ai_review_settings` ADD `auto_resolve_threads` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `ai_review_settings` ADD `post_reply_on_push` integer DEFAULT true;