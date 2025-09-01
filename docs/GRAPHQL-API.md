# Git Insider GraphQL API

Endpoint: POST http://localhost:3201/api/graphql
Content-Type: application/json

## Authentication
- JWT: `Authorization: Bearer <JWT>`
- API Key: `X-API-Key: <token>`
- If both headers are present, `X-API-Key` is used.

Tokens are managed via REST under `/api/auth/tokens` (requires JWT). See REST-API.md for details.

## Queries
Below reflects `routes/graphql.js` schema.

- repositories: [Repository!]!
- repositoryStats(id: Int!): RepoStats
- commits(
  user: String,
  users: [String!],
  startDate: String,
  endDate: String,
  repositories: [Int!],
  branch: String,
  page: Int,
  limit: Int,
  includeUnnamed: Boolean,
  includeChanges: Boolean,
  noCache: Boolean
): CommitsResult!
- codeChanges(
  user: String,
  users: [String!],
  startDate: String,
  endDate: String,
  repositories: [Int!],
  page: Int,
  limit: Int,
  includeUnnamed: Boolean
): [CodeChange!]!
- commitDetails(repositoryId: Int!, hash: String!): CommitDetails
- commitDetailsByPath(repoPath: String!, hash: String!): CommitDetails
- fileDiff(repositoryId: Int!, hash: String!, filePath: String!): String!
- fileDiffByPath(repoPath: String!, hash: String!, filePath: String!): String!
- gitUsers: [GitUser!]!
- branches(repositoryId: Int!): Branches
- workspaces: [Workspace!]!
- workspacesRepositories(workspaces: [Int!], maxDepth: Int, exclude: [String!], followSymlinks: Boolean): [WorkspaceRepo!]!
- projectChanges(repositoryId: Int!, startDate: String, endDate: String, page: Int, limit: Int): [CodeChange!]!

Notes:
- Commits and CodeChanges always search across saved Work Spaces; `repositories` arg is currently not used for filtering.
- By default, only repositories with a GitLab project name (`display_name`) are included. Set `includeUnnamed: true` to include repositories without a saved name.
- A month-based in-memory cache is used for named repositories by default. Set `noCache: true` to bypass the cache and fetch directly from git.
- By default, commits query searches all branches (`--all`). Specify `branch` parameter to search a specific branch (e.g., `branch: "main"`, `branch: "develop"`).
- Set `includeChanges: true` to enrich each commit with per-file additions/deletions. File stats are fetched on demand and are not stored in the month cache.
- Pagination for list queries is simple in-memory slicing when `limit` is provided; `page` defaults to 1 when used.
- Dates are ISO-8601 strings (e.g., `2024-01-01`). Ranges are inclusive.

## Types
- Repository: { id: ID!, name: String!, path: String!, url: String, description: String }
- FileStat: { filename: String!, additions: Int!, deletions: Int! }
- Commit: { repository: String!, repositoryId: Int, repositoryPath: String, hash: String!, author: String, authorEmail: String, date: String, message: String, body: String, branch: String, files: [FileStat!], changes: String }
- CodeChange: { repository: String!, repositoryId: Int, hash: String!, author: String, email: String, date: String, message: String, files: [FileStat!]! }
- CommitSummary: { hash: String, author: String, date: String, message: String }
- RepoStats: { repository: String!, totalCommits: Int!, contributors: Int!, branches: Int!, lastCommit: CommitSummary }
- Branches: { current: String, detached: Boolean, all: [String!]! }
- CommitDetails: { repository: String!, hash: String!, details: String!, changedFiles: String! }
- GitUser: { name: String, email: String }
- Workspace: { id: ID!, root_path: String!, name: String, repo_count: Int, last_scanned_at: String, is_active: Int }
- WorkspaceRepo: { workspaceId: Int, workspaceName: String, name: String, path: String, alreadyAdded: Boolean }
- Pagination: { page: Int!, limit: Int!, total: Int!, totalPages: Int! }
- CommitsResult: { commits: [Commit!]!, pagination: Pagination! }

## Examples

Fetch commits by user with pagination (matches REST shape):
```bash
curl -sS http://localhost:3201/api/graphql \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_TOKEN_HERE' \
  --data '{
    "query": "query($user:String,$page:Int,$limit:Int){ commits(user:$user,page:$page,limit:$limit){ commits { repository repositoryPath repositoryId hash author date message branch } pagination { page limit total totalPages } } }",
    "variables": {"user":"alice","page":1,"limit":20}
  }'
```

Fetch commits bypassing cache:
```bash
curl -sS http://localhost:3201/api/graphql \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_TOKEN_HERE' \
  --data '{
    "query": "query($user:String,$noCache:Boolean){ commits(user:$user, noCache:$noCache){ commits { repository hash author date message } pagination { page limit total totalPages } } }",
    "variables": {"user":"alice","noCache":true}
  }'
```

Fetch commits including unnamed repositories:
```bash
curl -sS http://localhost:3201/api/graphql \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_TOKEN_HERE' \
  --data '{
    "query": "query($user:String,$include:Boolean){ commits(user:$user, includeUnnamed:$include){ commits { repository hash author date message } pagination { page limit total totalPages } } }",
    "variables": {"user":"alice","include":true}
  }'
```

Fetch commits from specific branch:
```bash
curl -sS http://localhost:3201/api/graphql \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_TOKEN_HERE' \
  --data '{
    "query": "query($user:String,$branch:String){ commits(user:$user, branch:$branch){ commits { repository hash author date message branch } pagination { page limit total totalPages } } }",
    "variables": {"user":"alice","branch":"main"}
  }'
```

Fetch commits including per-file stats (on demand):
```bash
curl -sS http://localhost:3201/api/graphql \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_TOKEN_HERE' \
  --data '{
    "query": "query($user:String){ commits(user:$user, includeChanges:true){ commits { repository hash message files { filename additions deletions } } pagination { page limit total totalPages } } }",
    "variables": {"user":"alice"}
  }'
```

Get commit details by repository path:
```bash
curl -sS http://localhost:3201/api/graphql \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_JWT' \
  --data '{
    "query": "query($repoPath:String!,$hash:String!){ commitDetailsByPath(repoPath:$repoPath, hash:$hash){ repository hash details changedFiles } }",
    "variables": {"repoPath":"/abs/path/to/repo","hash":"abc123"}
  }'
```

Show file diff (plain text string):
```bash
curl -sS http://localhost:3201/api/graphql \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_TOKEN_HERE' \
  --data '{
    "query": "query($id:Int!,$hash:String!,$file:String!){ fileDiff(repositoryId:$id, hash:$hash, filePath:$file) }",
    "variables": {"id":1,"hash":"abc123","file":"src/app.js"}
  }'
```

List Work Spaces and discover repositories:
```bash
curl -sS http://localhost:3201/api/graphql \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_TOKEN_HERE' \
  --data '{
    "query": "{ workspaces { id name root_path repo_count last_scanned_at } }"
  }'

curl -sS http://localhost:3201/api/graphql \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_TOKEN_HERE' \
  --data '{
    "query": "query($ids:[Int!],$max:Int,$exclude:[String!],$follow:Boolean){ workspacesRepositories(workspaces:$ids,maxDepth:$max,exclude:$exclude,followSymlinks:$follow){ workspaceId workspaceName name path alreadyAdded } }",
    "variables": {"ids":[1,2],"max":3,"exclude":["node_modules",".git"],"follow":false}
  }'
```

## Errors
Standard GraphQL response format with `errors` array. Authorization failures return HTTP 401/403 or GraphQL errors depending on middleware phase.
