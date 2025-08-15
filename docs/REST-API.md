# Git Insider REST API

Base URL: http://localhost:3201
All REST endpoints are mounted under `/api/*`.

- Rate limit: 1000 requests / 15 minutes per IP on `/api/*`
- Content-Type: application/json unless otherwise noted
- Errors: JSON `{ "error": string }`

## Authentication

Two auth mechanisms exist; support varies by route group:

- JWT access token (Authorization header):
  - Header: `Authorization: Bearer <JWT>`
  - Obtain via `POST /api/auth/login`
  - Required for: `/api/auth/*` and `/api/admin/*`
- API Key (X-API-Key header):
  - Header: `X-API-Key: <token>`
  - Create/revoke via `/api/auth/tokens` (requires JWT)
  - Supported on: `/api/git/*` only (and GraphQL, see separate doc)

If both headers are present on `/api/git/*`, `X-API-Key` is used.


## Auth Routes (`/api/auth`)

- POST `/api/auth/login`
  - Body: `{ "username": string, "password": string }`
  - 200: `{ user: { id, username, email, role }, token }`

- GET `/api/auth/me` (JWT)
  - 200: `{ id, username, email, role, created_at, updated_at }`

- PUT `/api/auth/change-password` (JWT)
  - Body: `{ "currentPassword": string, "newPassword": string }`
  - 200: `{ message: 'Password updated successfully' }`

- GET `/api/auth/tokens` (JWT)
  - 200: `[{ id, name, expires_at, created_at, is_active }]`

- POST `/api/auth/tokens` (JWT)
  - Body: `{ "name": string, "expiresAt"?: string | null }`
  - 200: `{ id, token, name, expires_at, created_at }`

- DELETE `/api/auth/tokens/:tokenId` (JWT)
  - 200: `{ message: 'Token revoked successfully' }`

Example (login):
```bash
curl -sS http://localhost:3201/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"secret"}'
```


## Admin Routes (`/api/admin`) [JWT + Admin role]

- GET `/api/admin/users`
- POST `/api/admin/users`
  - Body: `{ username, password, email?, role? }`
- PUT `/api/admin/users/:id`
  - Body: `{ username?, email?, role?, password? }`
- DELETE `/api/admin/users/:id`

- POST `/api/admin/repositories`
  - Body: `{ name, path, url?, description? }`

- GET `/api/admin/stats`
  - 200: `{ totalUsers, adminUsers, regularUsers, totalRepositories, activeRepositories }`

- DELETE `/api/admin/workspaces/:id`

Notes:
- You cannot delete your own user or change your own role.


## Git Routes (`/api/git`) [JWT or API Key]

- GET `/api/git/repositories`
  - List repositories tracked in DB.

- GET `/api/git/repositories/:id/stats`
  - Repo stats including last commit summary.

- GET `/api/git/repositories/:id/branches`
  - Branch info: `{ current, detached, all[] }`

- GET `/api/git/repositories/:id/changes`
  - Query: `startDate?, endDate?, page=1, limit=50`
  - Paginates server-side by slicing results.

- GET `/api/git/commits`
  - Query: `user?` OR `users=alice,bob`, `startDate?`, `endDate?`, `page=1`, `limit=50`
  - Always searches across repositories discovered under saved Work Spaces.
  - Response: `{ commits: Commit[], pagination: { page, limit, total, totalPages } }`

- GET `/api/git/commits/by-path`
  - Query: `repoPath`, `hash`

- GET `/api/git/commits/:repositoryId/:hash`

- GET `/api/git/code-changes`
  - Query: `user?` OR `users=...`, `startDate?`, `endDate?`, `page=1`, `limit=50`
  - Always searches across saved Work Spaces.

- GET `/api/git/search/commits`
  - Query: `query` (required), `repositories?=1,2`, `startDate?`, `endDate?`, `page=1`, `limit=50`
  - Filters commits by message/body substring.

- GET `/api/git/diff/:repositoryId/:hash`
  - Query: `filePath` (required)
  - Response: plain text diff

- GET `/api/git/diff/by-path`
  - Query: `repoPath`, `hash`, `filePath` (all required)
  - Response: plain text diff

- GET `/api/git/users`
  - All distinct git users across repos.

- GET `/api/git/workspaces`
  - List saved WorkSpaces.

- GET `/api/git/workspaces/repositories`
  - Query: `workspaces?=1,2`, `maxDepth?`, `exclude?=dir1,dir2`, `followSymlinks?=true|false`
  - Returns `{ count, repositories }` discovered under selected/all workspaces.

- POST `/api/git/repositories/scan`
  - Body: `{ path: string, maxDepth?, exclude?: string[], followSymlinks?: boolean }`
  - Scans a folder for repos (does not persist a workspace).

- POST `/api/git/workspaces/scan`
  - Body: `{ path: string, maxDepth?, exclude?: string[], followSymlinks?: boolean }`
  - Scans and persists/updates a Work Space entry; returns repo count + repositories.

Examples:
```bash
# Using API Key
curl -sS 'http://localhost:3201/api/git/commits?user=alice&page=1&limit=20' \
  -H 'X-API-Key: YOUR_TOKEN_HERE'

# Using JWT
curl -sS 'http://localhost:3201/api/git/diff/1/abc123?filePath=src/app.js' \
  -H 'Authorization: Bearer YOUR_JWT'
```

### Date formats
- Dates are ISO-8601 strings (e.g., `2024-01-01` or full timestamps). Ranges are inclusive.

### Pagination
- Endpoints that accept `page` and `limit` perform simple in-memory slicing. Metadata is returned on REST endpoints that advertise it.

