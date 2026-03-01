# Atlassian Integration Design

**Date:** 2026-02-23
**Branch:** `add-atlassian-integration`

## Goal

Allow BranchFlux users to connect their Atlassian account and view:
- Open/draft Bitbucket PRs they authored (for tracked repos)
- Open Bitbucket PRs where they are a reviewer (for tracked repos)
- Unresolved Jira issues assigned to them

No app tokens or manual configuration required — OAuth 2.0 handles everything.

## Architecture

Single `atlassian` tRPC router in the Electron main process. OAuth tokens stored in SQLite. TanStack Query for renderer-side caching.

```
renderer (React)
  └── tRPC client
        └── atlassian router (main process)
              ├── auth (OAuth flows, token management)
              ├── bitbucket (PR queries)
              └── jira (issue queries)
              └── SQLite (tokens)
```

## Authentication

### OAuth 2.0 (3LO) — Two Separate Flows

Jira and Bitbucket use **separate OAuth systems**. A single "Connect Atlassian" button triggers both flows sequentially.

**Jira OAuth:**
- Authorization: `https://auth.atlassian.com/authorize`
- Token exchange: `https://auth.atlassian.com/oauth/token`
- Scopes: `read:jira-work`, `read:jira-user`, `offline_access`

**Bitbucket OAuth:**
- Authorization: `https://bitbucket.org/site/oauth2/authorize`
- Token exchange: `https://bitbucket.org/site/oauth2/access_token`
- Scopes (configured on consumer): `pullrequest`, `account`

### Flow

1. User clicks "Connect Atlassian" in Settings
2. App starts temporary HTTP server on `localhost:27391`
3. Opens system browser → Jira consent → callback with code
4. Exchanges code for tokens, calls accessible-resources to get cloudId
5. Opens system browser → Bitbucket consent → callback with code
6. Exchanges code for tokens, fetches user account ID
7. Stores all tokens in SQLite, shuts down temp server

### Token Management

- Access tokens expire in 1 hour
- Refresh tokens rotate (new token on each refresh, 90-day expiry)
- HTTP client wrapper transparently refreshes before expired API calls
- Client credentials (client_id/secret) embedded in app binary

### DB Table: `atlassian_auth`

| Column | Type | Description |
|--------|------|-------------|
| service | text PK | `"jira"` or `"bitbucket"` |
| access_token | text | Current access token |
| refresh_token | text | Current refresh token |
| expires_at | integer | Token expiry timestamp |
| cloud_id | text | Jira cloud ID (null for bitbucket) |
| account_id | text | User's Atlassian account ID |
| display_name | text | User display name |

## API Layer

### tRPC Router: `atlassian`

```
atlassian
├── auth
│   ├── connect()          — Initiates OAuth flow
│   ├── disconnect()       — Clears tokens
│   └── getStatus()        — Returns connection status per service
├── bitbucket
│   ├── getMyPullRequests()     — PRs authored by user (tracked repos)
│   └── getReviewRequests()     — PRs where user is reviewer (tracked repos)
└── jira
    └── getMyIssues()           — Unresolved issues assigned to user
```

### Bitbucket PR Strategy

For tracked repos only (repos already in BranchFlux with `bitbucket.org` remote):
1. Iterate over projects with Bitbucket remotes
2. Per repo: `GET /2.0/repositories/{workspace}/{repo_slug}/pullrequests?state=OPEN&q=author.account_id="..."`
3. For reviews: same with `q=reviewers.account_id="..."`

### Jira Issue Strategy

Single query: `GET /rest/api/3/search/jql` with:
```
jql=assignee=currentUser() AND resolution IS EMPTY ORDER BY updated DESC
fields=summary,status,priority,issuetype,project,created,updated
```

### Caching

TanStack Query on renderer side. No server-side cache. 30-second stale time.

## UI Design

### Sidebar Layout

```
┌─────────────────────┐
│  BRANCHFLUX         │
├─────────────────────┤
│  + Add Repository   │
├─────────────────────┤
│  ▼ Projects         │
│    my-project       │
│    other-repo       │
├─────────────────────┤
│  ▼ Pull Requests (3)│
│    ● My PRs (2)     │
│      #42 Fix login  │
│      #38 Add tests  │
│    ● Reviews (1)    │
│      #45 Refactor   │
├─────────────────────┤
│  ▼ Jira (5)         │
│    PROJ-123 Fix bug │
│    PROJ-124 Add ... │
├─────────────────────┤
│  ⚙ Settings         │
└─────────────────────┘
```

- PR items: number, title, status badge (open/draft), repo name
- Jira items: key, summary, status badge, priority icon
- Click: opens in system browser
- Empty/disconnected: "Connect Atlassian" link
- Loading: skeleton
- Error: "Could not load" with retry

### Settings Panel

- Atlassian section with connection status per service
- Connect / Disconnect buttons
- Jira site selector (if multiple accessible resources)

## Error Handling

- **Token expiry:** Transparent refresh. If refresh fails, non-blocking notification to reconnect.
- **Network errors:** TanStack Query retries (3x exponential backoff). Manual retry button.
- **Multiple Jira sites:** Prompt selection after OAuth, store selected cloudId.
- **No Bitbucket repos:** Empty state, no error.
- **Rate limits:** Well within limits (Bitbucket 1000/hr, Jira ~100/min) with tracked-repos-only approach.
- **Disconnection:** Clear tokens, invalidate cache, collapse to connect state.

## File Structure

```
apps/desktop/src/main/
├── atlassian/
│   ├── auth.ts              — OAuth flow, token management, HTTP client
│   ├── bitbucket.ts         — Bitbucket API calls
│   ├── jira.ts              — Jira API calls
│   └── constants.ts         — Client IDs, URLs, scopes
├── db/
│   └── schema.ts            — + atlassian_auth table
├── trpc/routers/
│   └── atlassian.ts         — tRPC router

apps/desktop/src/renderer/
├── components/
│   ├── AtlassianPanel.tsx   — Sidebar section
│   ├── PullRequestList.tsx  — PR list
│   ├── JiraIssueList.tsx    — Jira list
│   └── SettingsModal.tsx    — Settings with Atlassian connection
├── stores/
│   └── atlassian.ts         — Connection state store
```

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth strategy | Embedded credentials | Standard for desktop apps (VS Code, GitKraken). No PKCE support from Atlassian. |
| PR scope | Tracked repos only | Simpler, faster, more relevant. No need to discover all workspaces. |
| Auth UX | Single "Connect" button | Sequential flows behind one action. Both use same Atlassian account. |
| Data display | Sidebar panels | Keeps main area for terminals. Non-intrusive, always visible. |
| Caching | TanStack Query only | Already in project. No server-side cache complexity. |
| Architecture | Monolithic service | Follows existing tRPC router pattern. Simple, extensible. |
