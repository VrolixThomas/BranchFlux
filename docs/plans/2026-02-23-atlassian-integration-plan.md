# Atlassian Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow BranchFlux users to connect Jira + Bitbucket via OAuth and view their PRs and Jira issues in the sidebar.

**Architecture:** Single `atlassian` tRPC router in the Electron main process. OAuth via localhost callback server. Tokens in SQLite. TanStack Query for renderer caching. Two new sidebar sections for PRs and Jira issues.

**Tech Stack:** tRPC 11, Drizzle ORM, SQLite, React 19, Zustand, TanStack Query, Zod, Electron IPC

**Design doc:** `docs/plans/2026-02-23-atlassian-integration-design.md`

---

## Task 1: Database Schema — `atlassian_auth` Table

**Files:**
- Modify: `apps/desktop/src/main/db/schema.ts`

**Step 1: Add the atlassian_auth table to the schema**

Add this at the end of `schema.ts`, after `sessionState`:

```ts
export const atlassianAuth = sqliteTable("atlassian_auth", {
	service: text("service", { enum: ["jira", "bitbucket"] }).primaryKey(),
	accessToken: text("access_token").notNull(),
	refreshToken: text("refresh_token").notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	cloudId: text("cloud_id"),
	accountId: text("account_id").notNull(),
	displayName: text("display_name"),
});

export type AtlassianAuth = typeof atlassianAuth.$inferSelect;
export type NewAtlassianAuth = typeof atlassianAuth.$inferInsert;
```

**Step 2: Generate the migration**

Run: `cd apps/desktop && bun run db:generate`

Expected: A new migration file appears in `src/main/db/migrations/` with a `CREATE TABLE atlassian_auth` statement.

**Step 3: Commit**

```bash
git add apps/desktop/src/main/db/schema.ts apps/desktop/src/main/db/migrations/
git commit -m "feat: add atlassian_auth table to database schema"
```

---

## Task 2: Atlassian Constants

**Files:**
- Create: `apps/desktop/src/main/atlassian/constants.ts`

**Step 1: Create the constants file**

```ts
// OAuth credentials — embedded in app binary.
// These are scoped to user-authorized tokens only.
export const JIRA_CLIENT_ID = "PLACEHOLDER_JIRA_CLIENT_ID";
export const JIRA_CLIENT_SECRET = "PLACEHOLDER_JIRA_CLIENT_SECRET";

export const BITBUCKET_CLIENT_ID = "PLACEHOLDER_BITBUCKET_CLIENT_ID";
export const BITBUCKET_CLIENT_SECRET = "PLACEHOLDER_BITBUCKET_CLIENT_SECRET";

export const OAUTH_CALLBACK_PORT = 27391;
export const OAUTH_CALLBACK_URL = `http://localhost:${OAUTH_CALLBACK_PORT}/callback`;

export const JIRA_AUTH_URL = "https://auth.atlassian.com/authorize";
export const JIRA_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
export const JIRA_ACCESSIBLE_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources";

export const BITBUCKET_AUTH_URL = "https://bitbucket.org/site/oauth2/authorize";
export const BITBUCKET_TOKEN_URL = "https://bitbucket.org/site/oauth2/access_token";
export const BITBUCKET_API_BASE = "https://api.bitbucket.org/2.0";

export const JIRA_SCOPES = "read:jira-work read:jira-user offline_access";
```

**Step 2: Commit**

```bash
git add apps/desktop/src/main/atlassian/constants.ts
git commit -m "feat: add Atlassian OAuth constants"
```

---

## Task 3: OAuth Auth Module — Token Storage & Refresh

**Files:**
- Create: `apps/desktop/src/main/atlassian/auth.ts`

**Step 1: Create the auth module**

This module handles: token CRUD in SQLite, token refresh, and an authenticated fetch wrapper.

```ts
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { atlassianAuth } from "../db/schema";
import {
	BITBUCKET_CLIENT_ID,
	BITBUCKET_CLIENT_SECRET,
	BITBUCKET_TOKEN_URL,
	JIRA_CLIENT_ID,
	JIRA_CLIENT_SECRET,
	JIRA_TOKEN_URL,
} from "./constants";

type Service = "jira" | "bitbucket";

export function getAuth(service: Service) {
	const db = getDb();
	return db.select().from(atlassianAuth).where(eq(atlassianAuth.service, service)).get() ?? null;
}

export function saveAuth(data: {
	service: Service;
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
	cloudId?: string;
	accountId: string;
	displayName?: string;
}) {
	const db = getDb();
	const expiresAt = new Date(Date.now() + data.expiresIn * 1000);

	db.insert(atlassianAuth)
		.values({
			service: data.service,
			accessToken: data.accessToken,
			refreshToken: data.refreshToken,
			expiresAt,
			cloudId: data.cloudId ?? null,
			accountId: data.accountId,
			displayName: data.displayName ?? null,
		})
		.onConflictDoUpdate({
			target: atlassianAuth.service,
			set: {
				accessToken: data.accessToken,
				refreshToken: data.refreshToken,
				expiresAt,
				cloudId: data.cloudId ?? null,
				accountId: data.accountId,
				displayName: data.displayName ?? null,
			},
		})
		.run();
}

export function deleteAuth(service: Service) {
	const db = getDb();
	db.delete(atlassianAuth).where(eq(atlassianAuth.service, service)).run();
}

async function refreshJiraToken(refreshToken: string): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> {
	const res = await fetch(JIRA_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "refresh_token",
			client_id: JIRA_CLIENT_ID,
			client_secret: JIRA_CLIENT_SECRET,
			refresh_token: refreshToken,
		}),
	});
	if (!res.ok) {
		throw new Error(`Jira token refresh failed: ${res.status} ${await res.text()}`);
	}
	return res.json();
}

async function refreshBitbucketToken(refreshToken: string): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> {
	const credentials = Buffer.from(`${BITBUCKET_CLIENT_ID}:${BITBUCKET_CLIENT_SECRET}`).toString("base64");
	const res = await fetch(BITBUCKET_TOKEN_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${credentials}`,
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}),
	});
	if (!res.ok) {
		throw new Error(`Bitbucket token refresh failed: ${res.status} ${await res.text()}`);
	}
	return res.json();
}

/**
 * Returns a valid access token for the given service.
 * Refreshes automatically if expired. Returns null if not connected.
 */
export async function getValidToken(service: Service): Promise<string | null> {
	const auth = getAuth(service);
	if (!auth) return null;

	// Refresh if expiring within 60 seconds
	const now = new Date();
	const bufferMs = 60_000;
	if (auth.expiresAt.getTime() - now.getTime() > bufferMs) {
		return auth.accessToken;
	}

	try {
		const refreshFn = service === "jira" ? refreshJiraToken : refreshBitbucketToken;
		const result = await refreshFn(auth.refreshToken);

		saveAuth({
			service,
			accessToken: result.access_token,
			refreshToken: result.refresh_token,
			expiresIn: result.expires_in,
			cloudId: auth.cloudId ?? undefined,
			accountId: auth.accountId,
			displayName: auth.displayName ?? undefined,
		});

		return result.access_token;
	} catch (err) {
		console.error(`Token refresh failed for ${service}:`, err);
		deleteAuth(service);
		return null;
	}
}

/**
 * Authenticated fetch — adds Bearer token, refreshes if needed.
 * Throws if not connected or refresh fails.
 */
export async function atlassianFetch(service: Service, url: string, init?: RequestInit): Promise<Response> {
	const token = await getValidToken(service);
	if (!token) {
		throw new Error(`Not connected to ${service}`);
	}

	return fetch(url, {
		...init,
		headers: {
			...init?.headers,
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
		},
	});
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/main/atlassian/auth.ts
git commit -m "feat: add Atlassian auth module with token storage and refresh"
```

---

## Task 4: OAuth Flow — Localhost Callback Server

**Files:**
- Create: `apps/desktop/src/main/atlassian/oauth-flow.ts`

**Step 1: Create the OAuth flow module**

This module starts a temporary HTTP server, opens the browser for consent, captures the authorization code, exchanges it for tokens, and saves them.

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { shell } from "electron";
import { atlassianFetch, saveAuth } from "./auth";
import {
	BITBUCKET_AUTH_URL,
	BITBUCKET_CLIENT_ID,
	BITBUCKET_CLIENT_SECRET,
	BITBUCKET_TOKEN_URL,
	JIRA_AUTH_URL,
	JIRA_ACCESSIBLE_RESOURCES_URL,
	JIRA_CLIENT_ID,
	JIRA_CLIENT_SECRET,
	JIRA_SCOPES,
	JIRA_TOKEN_URL,
	OAUTH_CALLBACK_PORT,
	OAUTH_CALLBACK_URL,
} from "./constants";

function randomState(): string {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function waitForCallback(expectedState: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			const url = new URL(req.url ?? "/", `http://localhost:${OAUTH_CALLBACK_PORT}`);

			if (url.pathname !== "/callback") {
				res.writeHead(404);
				res.end("Not found");
				return;
			}

			const code = url.searchParams.get("code");
			const state = url.searchParams.get("state");
			const error = url.searchParams.get("error");

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end("<html><body><h2>Authorization complete. You can close this tab.</h2></body></html>");

			server.close();

			if (error) {
				reject(new Error(`OAuth error: ${error}`));
			} else if (state !== expectedState) {
				reject(new Error("OAuth state mismatch"));
			} else if (!code) {
				reject(new Error("No authorization code received"));
			} else {
				resolve(code);
			}
		});

		server.listen(OAUTH_CALLBACK_PORT);

		// Timeout after 5 minutes
		setTimeout(() => {
			server.close();
			reject(new Error("OAuth flow timed out"));
		}, 5 * 60 * 1000);
	});
}

async function exchangeJiraCode(code: string): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> {
	const res = await fetch(JIRA_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "authorization_code",
			client_id: JIRA_CLIENT_ID,
			client_secret: JIRA_CLIENT_SECRET,
			code,
			redirect_uri: OAUTH_CALLBACK_URL,
		}),
	});
	if (!res.ok) {
		throw new Error(`Jira token exchange failed: ${res.status} ${await res.text()}`);
	}
	return res.json();
}

async function exchangeBitbucketCode(code: string): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> {
	const credentials = Buffer.from(`${BITBUCKET_CLIENT_ID}:${BITBUCKET_CLIENT_SECRET}`).toString("base64");
	const res = await fetch(BITBUCKET_TOKEN_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${credentials}`,
		},
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
		}),
	});
	if (!res.ok) {
		throw new Error(`Bitbucket token exchange failed: ${res.status} ${await res.text()}`);
	}
	return res.json();
}

async function fetchJiraCloudId(accessToken: string): Promise<{
	cloudId: string;
	siteName: string;
}> {
	const res = await fetch(JIRA_ACCESSIBLE_RESOURCES_URL, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
		},
	});
	if (!res.ok) {
		throw new Error(`Failed to fetch Jira accessible resources: ${res.status}`);
	}
	const resources = (await res.json()) as Array<{ id: string; name: string; url: string }>;
	if (resources.length === 0) {
		throw new Error("No Jira sites found for this account");
	}
	// Use the first site. TODO: let user choose if multiple.
	const site = resources[0]!;
	return { cloudId: site.id, siteName: site.name };
}

async function fetchJiraUser(accessToken: string, cloudId: string): Promise<{
	accountId: string;
	displayName: string;
}> {
	const res = await fetch(
		`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`,
		{
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
			},
		}
	);
	if (!res.ok) {
		throw new Error(`Failed to fetch Jira user: ${res.status}`);
	}
	const user = (await res.json()) as { accountId: string; displayName: string };
	return { accountId: user.accountId, displayName: user.displayName };
}

async function fetchBitbucketUser(accessToken: string): Promise<{
	accountId: string;
	displayName: string;
}> {
	const res = await fetch("https://api.bitbucket.org/2.0/user", {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
		},
	});
	if (!res.ok) {
		throw new Error(`Failed to fetch Bitbucket user: ${res.status}`);
	}
	const user = (await res.json()) as { account_id: string; display_name: string };
	return { accountId: user.account_id, displayName: user.display_name };
}

export async function connectJira(): Promise<void> {
	const state = randomState();
	const authUrl = `${JIRA_AUTH_URL}?audience=api.atlassian.com&client_id=${JIRA_CLIENT_ID}&scope=${encodeURIComponent(JIRA_SCOPES)}&redirect_uri=${encodeURIComponent(OAUTH_CALLBACK_URL)}&state=${state}&response_type=code&prompt=consent`;

	shell.openExternal(authUrl);
	const code = await waitForCallback(state);
	const tokens = await exchangeJiraCode(code);
	const { cloudId, siteName } = await fetchJiraCloudId(tokens.access_token);
	const user = await fetchJiraUser(tokens.access_token, cloudId);

	saveAuth({
		service: "jira",
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		expiresIn: tokens.expires_in,
		cloudId,
		accountId: user.accountId,
		displayName: user.displayName,
	});
}

export async function connectBitbucket(): Promise<void> {
	const state = randomState();
	const authUrl = `${BITBUCKET_AUTH_URL}?client_id=${BITBUCKET_CLIENT_ID}&response_type=code&state=${state}`;

	shell.openExternal(authUrl);
	const code = await waitForCallback(state);
	const tokens = await exchangeBitbucketCode(code);
	const user = await fetchBitbucketUser(tokens.access_token);

	saveAuth({
		service: "bitbucket",
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		expiresIn: tokens.expires_in,
		accountId: user.accountId,
		displayName: user.displayName,
	});
}

export async function connectAll(): Promise<{ jira: boolean; bitbucket: boolean }> {
	const result = { jira: false, bitbucket: false };

	try {
		await connectJira();
		result.jira = true;
	} catch (err) {
		console.error("Jira connection failed:", err);
	}

	try {
		await connectBitbucket();
		result.bitbucket = true;
	} catch (err) {
		console.error("Bitbucket connection failed:", err);
	}

	return result;
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/main/atlassian/oauth-flow.ts
git commit -m "feat: add OAuth flow with localhost callback for Jira and Bitbucket"
```

---

## Task 5: Bitbucket API Module

**Files:**
- Create: `apps/desktop/src/main/atlassian/bitbucket.ts`

**Step 1: Create the Bitbucket API module**

```ts
import { getDb } from "../db";
import { projects } from "../db/schema";
import { parseRemoteUrl } from "../git/operations";
import { atlassianFetch, getAuth } from "./auth";
import { BITBUCKET_API_BASE } from "./constants";

export interface BitbucketPullRequest {
	id: number;
	title: string;
	state: string;
	author: string;
	repoSlug: string;
	workspace: string;
	webUrl: string;
	createdOn: string;
	updatedOn: string;
}

interface BitbucketApiPR {
	id: number;
	title: string;
	state: string;
	author: { display_name: string };
	source: { repository: { full_name: string } };
	links: { html: { href: string } };
	created_on: string;
	updated_on: string;
}

function mapPR(pr: BitbucketApiPR, workspace: string, repoSlug: string): BitbucketPullRequest {
	return {
		id: pr.id,
		title: pr.title,
		state: pr.state,
		author: pr.author.display_name,
		repoSlug,
		workspace,
		webUrl: pr.links.html.href,
		createdOn: pr.created_on,
		updatedOn: pr.updated_on,
	};
}

async function getBitbucketRepos(): Promise<Array<{ workspace: string; repoSlug: string }>> {
	const db = getDb();
	const allProjects = db.select().from(projects).all();
	const repos: Array<{ workspace: string; repoSlug: string }> = [];

	for (const project of allProjects) {
		const remote = await parseRemoteUrl(project.repoPath);
		if (remote && remote.host.includes("bitbucket")) {
			repos.push({ workspace: remote.owner, repoSlug: remote.repo });
		}
	}

	return repos;
}

export async function getMyPullRequests(): Promise<BitbucketPullRequest[]> {
	const auth = getAuth("bitbucket");
	if (!auth) return [];

	const repos = await getBitbucketRepos();
	if (repos.length === 0) return [];

	const allPRs: BitbucketPullRequest[] = [];

	for (const { workspace, repoSlug } of repos) {
		try {
			const url = `${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests?state=OPEN&q=author.account_id%3D%22${auth.accountId}%22`;
			const res = await atlassianFetch("bitbucket", url);
			if (!res.ok) continue;

			const data = (await res.json()) as { values: BitbucketApiPR[] };
			for (const pr of data.values) {
				allPRs.push(mapPR(pr, workspace, repoSlug));
			}
		} catch (err) {
			console.error(`Failed to fetch PRs for ${workspace}/${repoSlug}:`, err);
		}
	}

	return allPRs;
}

export async function getReviewRequests(): Promise<BitbucketPullRequest[]> {
	const auth = getAuth("bitbucket");
	if (!auth) return [];

	const repos = await getBitbucketRepos();
	if (repos.length === 0) return [];

	const allPRs: BitbucketPullRequest[] = [];

	for (const { workspace, repoSlug } of repos) {
		try {
			const url = `${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests?state=OPEN&q=reviewers.account_id%3D%22${auth.accountId}%22`;
			const res = await atlassianFetch("bitbucket", url);
			if (!res.ok) continue;

			const data = (await res.json()) as { values: BitbucketApiPR[] };
			for (const pr of data.values) {
				allPRs.push(mapPR(pr, workspace, repoSlug));
			}
		} catch (err) {
			console.error(`Failed to fetch review PRs for ${workspace}/${repoSlug}:`, err);
		}
	}

	return allPRs;
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/main/atlassian/bitbucket.ts
git commit -m "feat: add Bitbucket API module for pull requests"
```

---

## Task 6: Jira API Module

**Files:**
- Create: `apps/desktop/src/main/atlassian/jira.ts`

**Step 1: Create the Jira API module**

```ts
import { atlassianFetch, getAuth } from "./auth";

export interface JiraIssue {
	key: string;
	summary: string;
	status: string;
	statusCategory: string;
	priority: string;
	issueType: string;
	projectKey: string;
	webUrl: string;
	createdAt: string;
	updatedAt: string;
}

interface JiraApiIssue {
	key: string;
	fields: {
		summary: string;
		status: { name: string; statusCategory: { key: string } };
		priority: { name: string } | null;
		issuetype: { name: string };
		project: { key: string };
		created: string;
		updated: string;
	};
}

export async function getMyIssues(): Promise<JiraIssue[]> {
	const auth = getAuth("jira");
	if (!auth || !auth.cloudId) return [];

	const jql = "assignee = currentUser() AND resolution IS EMPTY ORDER BY updated DESC";
	const fields = "summary,status,priority,issuetype,project,created,updated";
	const url = `https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=50`;

	const res = await atlassianFetch("jira", url);
	if (!res.ok) {
		throw new Error(`Jira search failed: ${res.status} ${await res.text()}`);
	}

	const data = (await res.json()) as { issues: JiraApiIssue[] };
	const siteUrl = `https://api.atlassian.com/ex/jira/${auth.cloudId}`;

	return data.issues.map((issue) => ({
		key: issue.key,
		summary: issue.fields.summary,
		status: issue.fields.status.name,
		statusCategory: issue.fields.status.statusCategory.key,
		priority: issue.fields.priority?.name ?? "None",
		issueType: issue.fields.issuetype.name,
		projectKey: issue.fields.project.key,
		webUrl: `${siteUrl}/browse/${issue.key}`,
		createdAt: issue.fields.created,
		updatedAt: issue.fields.updated,
	}));
}
```

**Note:** The `webUrl` construction above uses the API base. We should use the actual site URL instead. We'll need to store it during OAuth or derive it from the cloud ID. For now this is a placeholder — the accessible-resources endpoint returns a `url` field (e.g., `https://my-site.atlassian.net`) that we should store. We'll fix this in integration testing. Alternatively, store the site URL in `atlassian_auth` as an additional column, or derive from `cloudId`.

**Step 2: Commit**

```bash
git add apps/desktop/src/main/atlassian/jira.ts
git commit -m "feat: add Jira API module for issue search"
```

---

## Task 7: tRPC Router — Atlassian

**Files:**
- Create: `apps/desktop/src/main/trpc/routers/atlassian.ts`
- Modify: `apps/desktop/src/main/trpc/routers/index.ts`

**Step 1: Create the Atlassian router**

```ts
import { z } from "zod";
import { deleteAuth, getAuth } from "../../atlassian/auth";
import { getMyPullRequests, getReviewRequests } from "../../atlassian/bitbucket";
import { getMyIssues } from "../../atlassian/jira";
import { connectAll, connectBitbucket, connectJira } from "../../atlassian/oauth-flow";
import { publicProcedure, router } from "../index";

export const atlassianRouter = router({
	getStatus: publicProcedure.query(() => {
		const jira = getAuth("jira");
		const bitbucket = getAuth("bitbucket");
		return {
			jira: jira
				? { connected: true as const, displayName: jira.displayName, accountId: jira.accountId }
				: { connected: false as const },
			bitbucket: bitbucket
				? { connected: true as const, displayName: bitbucket.displayName, accountId: bitbucket.accountId }
				: { connected: false as const },
		};
	}),

	connect: publicProcedure
		.input(z.object({ service: z.enum(["jira", "bitbucket", "all"]).optional().default("all") }))
		.mutation(async ({ input }) => {
			if (input.service === "jira") {
				await connectJira();
			} else if (input.service === "bitbucket") {
				await connectBitbucket();
			} else {
				await connectAll();
			}
			// Return updated status
			const jira = getAuth("jira");
			const bitbucket = getAuth("bitbucket");
			return {
				jira: jira
					? { connected: true as const, displayName: jira.displayName }
					: { connected: false as const },
				bitbucket: bitbucket
					? { connected: true as const, displayName: bitbucket.displayName }
					: { connected: false as const },
			};
		}),

	disconnect: publicProcedure
		.input(z.object({ service: z.enum(["jira", "bitbucket", "all"]) }))
		.mutation(({ input }) => {
			if (input.service === "all") {
				deleteAuth("jira");
				deleteAuth("bitbucket");
			} else {
				deleteAuth(input.service);
			}
		}),

	getMyPullRequests: publicProcedure.query(async () => {
		return getMyPullRequests();
	}),

	getReviewRequests: publicProcedure.query(async () => {
		return getReviewRequests();
	}),

	getMyIssues: publicProcedure.query(async () => {
		return getMyIssues();
	}),
});
```

**Step 2: Register the router**

In `apps/desktop/src/main/trpc/routers/index.ts`, add the import and register:

```ts
import { router } from "../index";
import { atlassianRouter } from "./atlassian";
import { branchesRouter } from "./branches";
import { projectsRouter } from "./projects";
import { terminalSessionsRouter } from "./terminal-sessions";
import { workspacesRouter } from "./workspaces";

export const appRouter = router({
	projects: projectsRouter,
	workspaces: workspacesRouter,
	branches: branchesRouter,
	terminalSessions: terminalSessionsRouter,
	atlassian: atlassianRouter,
});

export type AppRouter = typeof appRouter;
```

**Step 3: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/atlassian.ts apps/desktop/src/main/trpc/routers/index.ts
git commit -m "feat: add Atlassian tRPC router with auth, PR, and Jira endpoints"
```

---

## Task 8: Sidebar — Pull Request List Component

**Files:**
- Create: `apps/desktop/src/renderer/components/PullRequestList.tsx`

**Step 1: Create the component**

```tsx
import { shell } from "electron";
import { trpc } from "../trpc/client";

export function PullRequestList() {
	const { data: myPRs, isLoading: loadingMy } = trpc.atlassian.getMyPullRequests.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
	});
	const { data: reviewPRs, isLoading: loadingReviews } = trpc.atlassian.getReviewRequests.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
	});

	const isLoading = loadingMy || loadingReviews;
	const totalCount = (myPRs?.length ?? 0) + (reviewPRs?.length ?? 0);

	if (isLoading && !myPRs && !reviewPRs) {
		return (
			<div className="px-3 py-1">
				<div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-0.5">
			{/* My PRs */}
			{myPRs && myPRs.length > 0 && (
				<>
					<div className="px-3 py-0.5 text-[11px] font-medium text-[var(--text-quaternary)]">
						My PRs ({myPRs.length})
					</div>
					{myPRs.map((pr) => (
						<button
							key={`my-${pr.workspace}-${pr.repoSlug}-${pr.id}`}
							type="button"
							onClick={() => window.electron.shell?.openExternal(pr.webUrl)}
							className="flex w-full items-center gap-1.5 rounded-[6px] px-3 py-1 text-left text-[12px] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
							title={`${pr.repoSlug}#${pr.id}: ${pr.title}`}
						>
							<span className="shrink-0 text-[var(--text-quaternary)]">#{pr.id}</span>
							<span className="min-w-0 truncate">{pr.title}</span>
						</button>
					))}
				</>
			)}

			{/* Review requests */}
			{reviewPRs && reviewPRs.length > 0 && (
				<>
					<div className="px-3 py-0.5 text-[11px] font-medium text-[var(--text-quaternary)]">
						Reviews ({reviewPRs.length})
					</div>
					{reviewPRs.map((pr) => (
						<button
							key={`review-${pr.workspace}-${pr.repoSlug}-${pr.id}`}
							type="button"
							onClick={() => window.electron.shell?.openExternal(pr.webUrl)}
							className="flex w-full items-center gap-1.5 rounded-[6px] px-3 py-1 text-left text-[12px] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
							title={`${pr.repoSlug}#${pr.id}: ${pr.title}`}
						>
							<span className="shrink-0 text-[var(--text-quaternary)]">#{pr.id}</span>
							<span className="min-w-0 truncate">{pr.title}</span>
						</button>
					))}
				</>
			)}

			{totalCount === 0 && (
				<div className="px-3 py-1 text-[12px] text-[var(--text-quaternary)]">No pull requests</div>
			)}
		</div>
	);
}
```

**Note:** The `window.electron.shell?.openExternal` won't exist yet. We need to expose it via the preload script. This is addressed in Task 10.

**Step 2: Commit**

```bash
git add apps/desktop/src/renderer/components/PullRequestList.tsx
git commit -m "feat: add PullRequestList sidebar component"
```

---

## Task 9: Sidebar — Jira Issue List Component

**Files:**
- Create: `apps/desktop/src/renderer/components/JiraIssueList.tsx`

**Step 1: Create the component**

```tsx
import { trpc } from "../trpc/client";

export function JiraIssueList() {
	const { data: issues, isLoading } = trpc.atlassian.getMyIssues.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
	});

	if (isLoading && !issues) {
		return (
			<div className="px-3 py-1">
				<div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
			</div>
		);
	}

	if (!issues || issues.length === 0) {
		return (
			<div className="px-3 py-1 text-[12px] text-[var(--text-quaternary)]">No issues assigned</div>
		);
	}

	return (
		<div className="flex flex-col gap-0.5">
			{issues.map((issue) => (
				<button
					key={issue.key}
					type="button"
					onClick={() => window.electron.shell?.openExternal(issue.webUrl)}
					className="flex w-full items-center gap-1.5 rounded-[6px] px-3 py-1 text-left text-[12px] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
					title={`${issue.key}: ${issue.summary}`}
				>
					<span className="shrink-0 font-medium text-[var(--text-quaternary)]">{issue.key}</span>
					<span className="min-w-0 truncate">{issue.summary}</span>
				</button>
			))}
		</div>
	);
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/renderer/components/JiraIssueList.tsx
git commit -m "feat: add JiraIssueList sidebar component"
```

---

## Task 10: Preload — Expose shell.openExternal

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/shared/types.ts`

**Step 1: Add ShellAPI type**

In `apps/desktop/src/shared/types.ts`, add:

```ts
export interface ShellAPI {
	openExternal: (url: string) => Promise<void>;
}
```

**Step 2: Expose in preload**

In `apps/desktop/src/preload/index.ts`, add the shell API:

```ts
import { contextBridge, ipcRenderer, shell } from "electron";
```

Wait — `shell` is NOT available in the preload script (it's a main-process-only module). Instead, we need to use IPC:

In preload, add:

```ts
const shellAPI: ShellAPI = {
	openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
};
```

And add it to the `contextBridge.exposeInMainWorld` call:

```ts
contextBridge.exposeInMainWorld("electron", {
	terminal: terminalAPI,
	trpc: trpcAPI,
	dialog: dialogAPI,
	session: sessionAPI,
	shell: shellAPI,
});
```

**Step 3: Handle in main process**

In `apps/desktop/src/main/index.ts`, add after the `dialog:openDirectory` handler:

```ts
ipcMain.handle("shell:openExternal", async (_event, url: string) => {
	if (typeof url === "string" && (url.startsWith("https://") || url.startsWith("http://"))) {
		await shell.openExternal(url);
	}
});
```

Add `shell` to the existing electron import: `import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";`

**Step 4: Add type declaration for window.electron.shell**

The existing type augmentation for `window.electron` needs to include `shell`. Check if there's a `global.d.ts` or `env.d.ts` — if not, the types flow through the preload. The renderer components use `window.electron.shell?.openExternal()` with optional chaining, so even without perfect types it'll work at runtime. But for type safety, add to the `Window` type declaration if one exists.

**Step 5: Commit**

```bash
git add apps/desktop/src/preload/index.ts apps/desktop/src/shared/types.ts apps/desktop/src/main/index.ts
git commit -m "feat: expose shell.openExternal via IPC for opening URLs in browser"
```

---

## Task 11: Sidebar — Atlassian Panel (Collapsible Sections)

**Files:**
- Create: `apps/desktop/src/renderer/components/AtlassianPanel.tsx`

**Step 1: Create the panel component**

This wraps PullRequestList and JiraIssueList in collapsible sections and handles the disconnected state.

```tsx
import { useState } from "react";
import { trpc } from "../trpc/client";
import { JiraIssueList } from "./JiraIssueList";
import { PullRequestList } from "./PullRequestList";

function SectionHeader({
	label,
	count,
	isOpen,
	onToggle,
}: {
	label: string;
	count?: number;
	isOpen: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)] transition-colors hover:text-[var(--text-tertiary)]"
		>
			<svg
				aria-hidden="true"
				width="10"
				height="10"
				viewBox="0 0 10 10"
				fill="none"
				className={`shrink-0 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
			>
				<path d="M3 1.5L7 5L3 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
			<span>{label}</span>
			{count !== undefined && count > 0 && (
				<span className="ml-auto text-[10px] tabular-nums">{count}</span>
			)}
		</button>
	);
}

export function AtlassianPanel() {
	const { data: status } = trpc.atlassian.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const connectMutation = trpc.atlassian.connect.useMutation();

	const [prOpen, setPrOpen] = useState(true);
	const [jiraOpen, setJiraOpen] = useState(true);

	const isConnected = status?.jira.connected || status?.bitbucket.connected;

	if (!isConnected) {
		return (
			<div className="px-2 py-1">
				<button
					type="button"
					onClick={() => connectMutation.mutate({ service: "all" })}
					disabled={connectMutation.isPending}
					className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--text-quaternary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
				>
					{connectMutation.isPending ? "Connecting..." : "Connect Atlassian"}
				</button>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			{status?.bitbucket.connected && (
				<div>
					<SectionHeader label="Pull Requests" isOpen={prOpen} onToggle={() => setPrOpen(!prOpen)} />
					{prOpen && (
						<div className="px-2">
							<PullRequestList />
						</div>
					)}
				</div>
			)}
			{status?.jira.connected && (
				<div>
					<SectionHeader label="Jira" isOpen={jiraOpen} onToggle={() => setJiraOpen(!jiraOpen)} />
					{jiraOpen && (
						<div className="px-2">
							<JiraIssueList />
						</div>
					)}
				</div>
			)}
		</div>
	);
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/renderer/components/AtlassianPanel.tsx
git commit -m "feat: add AtlassianPanel with collapsible PR and Jira sections"
```

---

## Task 12: Integrate AtlassianPanel into Sidebar

**Files:**
- Modify: `apps/desktop/src/renderer/components/Sidebar.tsx`

**Step 1: Add the AtlassianPanel to the sidebar**

Replace the contents of `Sidebar.tsx` with:

```tsx
import { useProjectStore } from "../stores/projects";
import { AtlassianPanel } from "./AtlassianPanel";
import { ProjectList } from "./ProjectList";

export function Sidebar() {
	const { openAddModal } = useProjectStore();

	return (
		<aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]">
			{/* Traffic light clearance — empty drag region */}
			<div
				className="shrink-0"
				style={
					{
						height: 52,
						WebkitAppRegion: "drag",
					} as React.CSSProperties
				}
			/>

			{/* Wordmark */}
			<div className="px-4 pb-6">
				<span className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-quaternary)]">
					BranchFlux
				</span>
			</div>

			{/* Add Repository */}
			<div className="px-2 pb-2">
				<button
					type="button"
					onClick={openAddModal}
					className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-[13px] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					<svg
						aria-hidden="true"
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="none"
						className="shrink-0"
					>
						<path
							d="M8 3v10M3 8h10"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
					</svg>
					Add Repository
				</button>
			</div>

			{/* Project list */}
			<div className="flex-1 overflow-y-auto py-1">
				<ProjectList />

				{/* Atlassian integration */}
				<div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
					<AtlassianPanel />
				</div>
			</div>

			{/* Footer */}
			<div className="border-t border-[var(--border-subtle)] p-2">
				<button
					type="button"
					className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-[13px] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					<svg
						aria-hidden="true"
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="shrink-0"
					>
						<circle cx="12" cy="12" r="3" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
					</svg>
					Settings
				</button>
			</div>
		</aside>
	);
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/renderer/components/Sidebar.tsx
git commit -m "feat: integrate AtlassianPanel into sidebar"
```

---

## Task 13: Type-Check and Build Verification

**Step 1: Run type check**

Run: `cd apps/desktop && bun run type-check`

Expected: No errors. If there are errors, fix them (likely around the `window.electron.shell` type — may need to update the Window type declaration).

**Step 2: Run the build**

Run: `cd apps/desktop && bun run build`

Expected: Successful build with no errors.

**Step 3: Run existing tests**

Run: `cd apps/desktop && bun test`

Expected: All existing tests pass.

**Step 4: Commit any fixes**

If any fixes were needed:

```bash
git add -A
git commit -m "fix: resolve type errors from Atlassian integration"
```

---

## Task 14: Manual Integration Test

**Step 1: Set up OAuth apps**

Before testing, you need real OAuth credentials:

1. **Jira:** Go to https://developer.atlassian.com/console/, create an app, add Jira API permissions (`read:jira-work`, `read:jira-user`), configure OAuth 2.0 (3LO) with callback URL `http://localhost:27391/callback`
2. **Bitbucket:** Go to workspace settings → OAuth consumers, create a consumer with callback URL `http://localhost:27391/callback`, scopes: `pullrequest`, `account`

Replace the `PLACEHOLDER_*` values in `apps/desktop/src/main/atlassian/constants.ts` with real credentials.

**Step 2: Start the dev server**

Run: `cd apps/desktop && bun run dev`

**Step 3: Test the OAuth flow**

1. Check the sidebar — should show "Connect Atlassian" link
2. Click it — browser should open Jira consent screen
3. Authorize — browser should redirect to localhost, showing "Authorization complete"
4. Second browser tab opens for Bitbucket consent
5. Authorize — done
6. Sidebar should now show "Pull Requests" and "Jira" sections

**Step 4: Verify data**

1. PRs from tracked Bitbucket repos should appear under "My PRs" and "Reviews"
2. Jira issues assigned to you should appear under "Jira"
3. Clicking any item should open it in the browser

---

## Task 15: Settings — Disconnect Button

**Files:**
- Modify: `apps/desktop/src/renderer/components/AtlassianPanel.tsx`

**Step 1: Add a disconnect option**

Add a small "Disconnect" link at the bottom of the AtlassianPanel when connected. This can be a simple text button that calls `trpc.atlassian.disconnect.useMutation()` with `{ service: "all" }`.

The exact placement: after the Jira section, add:

```tsx
<div className="px-3 py-1">
	<button
		type="button"
		onClick={() => disconnectMutation.mutate({ service: "all" })}
		className="text-[11px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
	>
		Disconnect Atlassian
	</button>
</div>
```

Add `disconnectMutation` alongside the existing `connectMutation` and invalidate queries on success.

**Step 2: Commit**

```bash
git add apps/desktop/src/renderer/components/AtlassianPanel.tsx
git commit -m "feat: add disconnect button for Atlassian integration"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | DB schema: `atlassian_auth` table | `schema.ts`, migration |
| 2 | Constants: OAuth URLs, scopes, client IDs | `constants.ts` |
| 3 | Auth module: token CRUD, refresh, fetch wrapper | `auth.ts` |
| 4 | OAuth flow: localhost server, browser consent | `oauth-flow.ts` |
| 5 | Bitbucket API: PR fetching for tracked repos | `bitbucket.ts` |
| 6 | Jira API: issue search | `jira.ts` |
| 7 | tRPC router: wire everything to IPC | `atlassian.ts`, `index.ts` |
| 8 | UI: PullRequestList component | `PullRequestList.tsx` |
| 9 | UI: JiraIssueList component | `JiraIssueList.tsx` |
| 10 | Preload: expose shell.openExternal | `preload/index.ts`, `types.ts`, `main/index.ts` |
| 11 | UI: AtlassianPanel (collapsible wrapper) | `AtlassianPanel.tsx` |
| 12 | UI: Integrate into Sidebar | `Sidebar.tsx` |
| 13 | Build: type-check + test | All files |
| 14 | Manual: end-to-end test with real credentials | `constants.ts` |
| 15 | UI: Disconnect button | `AtlassianPanel.tsx` |
