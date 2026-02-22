import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { app } from "electron";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDbPath(): string {
	const userDataPath = app.getPath("userData");
	return join(userDataPath, "branchflux.db");
}

export function getDb() {
	if (_db) return _db;

	const dbPath = getDbPath();
	const dir = dirname(dbPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	const sqlite = new Database(dbPath);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");

	_db = drizzle(sqlite, { schema });
	return _db;
}

export function initializeDatabase(): void {
	const db = getDb();
	db.run(/* sql */ `
		CREATE TABLE IF NOT EXISTS projects (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			repo_path TEXT NOT NULL UNIQUE,
			default_branch TEXT NOT NULL DEFAULT 'main',
			color TEXT,
			github_owner TEXT,
			github_repo TEXT,
			status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('cloning', 'initializing', 'ready', 'error')),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)
	`);

	db.run(/* sql */ `
		CREATE TABLE IF NOT EXISTS worktrees (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			path TEXT NOT NULL UNIQUE,
			branch TEXT NOT NULL,
			base_branch TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)
	`);

	db.run(/* sql */ `
		CREATE TABLE IF NOT EXISTS workspaces (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			type TEXT NOT NULL CHECK(type IN ('branch', 'worktree')),
			name TEXT NOT NULL,
			worktree_id TEXT REFERENCES worktrees(id) ON DELETE CASCADE,
			terminal_id TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)
	`);

	db.run(/* sql */ `
		CREATE TABLE IF NOT EXISTS terminal_sessions (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
			title TEXT NOT NULL,
			cwd TEXT NOT NULL,
			scrollback TEXT,
			sort_order INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)
	`);

	db.run(/* sql */ `
		CREATE TABLE IF NOT EXISTS session_state (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)
	`);
}

export { schema };
