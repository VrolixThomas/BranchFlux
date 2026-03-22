import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { workspaces } from "./schema";

export const resolutionSessions = sqliteTable("resolution_sessions", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspaces.id),
	prProvider: text("pr_provider").notNull(),
	prIdentifier: text("pr_identifier").notNull(),
	commitShaBefore: text("commit_sha_before").notNull(),
	status: text("status").notNull().default("running"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const resolutionGroups = sqliteTable("resolution_groups", {
	id: text("id").primaryKey(),
	sessionId: text("session_id")
		.notNull()
		.references(() => resolutionSessions.id),
	commitSha: text("commit_sha").notNull(),
	commitMessage: text("commit_message").notNull(),
	status: text("status").notNull().default("applied"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const resolutionComments = sqliteTable("resolution_comments", {
	id: text("id").primaryKey(),
	groupId: text("group_id").references(() => resolutionGroups.id),
	sessionId: text("session_id")
		.notNull()
		.references(() => resolutionSessions.id),
	platformCommentId: text("platform_comment_id").notNull(),
	platformThreadId: text("platform_thread_id"),
	filePath: text("file_path"),
	lineNumber: integer("line_number"),
	author: text("author").notNull(),
	body: text("body").notNull(),
	status: text("status").notNull().default("pending"),
	skipReason: text("skip_reason"),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
