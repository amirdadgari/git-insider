const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const GitService = require('../models/GitService');
const { authenticateToken, authenticateApiToken } = require('../middleware/auth');

// Combined auth (supports JWT and API key like routes/git.js)
const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    return authenticateApiToken(req, res, next);
  }
  return authenticateToken(req, res, next);
};

// GraphQL type definitions
const typeDefs = /* GraphQL */ `
  type Repository {
    id: ID!
    name: String!
    path: String!
    url: String
    description: String
  }

  type Commit {
    repository: String!
    repositoryId: Int
    hash: String!
    author: String
    authorEmail: String
    date: String
    message: String
    body: String
  }

  type FileStat {
    filename: String!
    additions: Int!
    deletions: Int!
  }

  type CodeChange {
    repository: String!
    repositoryId: Int
    hash: String!
    author: String
    email: String
    date: String
    message: String
    files: [FileStat!]!
  }

  type CommitSummary {
    hash: String
    author: String
    date: String
    message: String
  }

  type RepoStats {
    repository: String!
    totalCommits: Int!
    contributors: Int!
    branches: Int!
    lastCommit: CommitSummary
  }

  type Branches {
    current: String
    detached: Boolean
    all: [String!]!
  }

  type CommitDetails {
    repository: String!
    hash: String!
    details: String!
    changedFiles: String!
  }

  type GitUser {
    name: String
    email: String
  }

  type Workspace {
    id: ID!
    root_path: String!
    name: String
    repo_count: Int
    last_scanned_at: String
    is_active: Int
  }

  type WorkspaceRepo {
    workspaceId: Int
    workspaceName: String
    name: String
    path: String
    alreadyAdded: Boolean
  }

  type Query {
    repositories: [Repository!]!
    repositoryStats(id: Int!): RepoStats

    commits(
      user: String,
      users: [String!],
      startDate: String,
      endDate: String,
      repositories: [Int!],
      page: Int,
      limit: Int,
      includeUnnamed: Boolean
    ): [Commit!]!

    codeChanges(
      user: String,
      users: [String!],
      startDate: String,
      endDate: String,
      repositories: [Int!],
      page: Int,
      limit: Int,
      includeUnnamed: Boolean
    ): [CodeChange!]!

    commitDetails(repositoryId: Int!, hash: String!): CommitDetails
    commitDetailsByPath(repoPath: String!, hash: String!): CommitDetails

    fileDiff(repositoryId: Int!, hash: String!, filePath: String!): String!
    fileDiffByPath(repoPath: String!, hash: String!, filePath: String!): String!

    gitUsers: [GitUser!]!
    branches(repositoryId: Int!): Branches

    workspaces: [Workspace!]!
    workspacesRepositories(
      workspaces: [Int!],
      maxDepth: Int,
      exclude: [String!],
      followSymlinks: Boolean
    ): [WorkspaceRepo!]!

    projectChanges(
      repositoryId: Int!,
      startDate: String,
      endDate: String,
      page: Int,
      limit: Int
    ): [CodeChange!]!
  }
`;

// Resolvers
const resolvers = {
  Query: {
    repositories: async (_p, _a, { gitService }) => {
      return gitService.getRepositories();
    },
    repositoryStats: async (_p, { id }, { gitService }) => {
      return gitService.getRepositoryStats(id);
    },
    commits: async (
      _p,
      { user, users, startDate, endDate, repositories, page, limit, includeUnnamed },
      { gitService }
    ) => {
      let userPattern = null;
      if (user) userPattern = user;
      else if (Array.isArray(users) && users.length) userPattern = users.join('|');

      // Always fetch across saved Work Spaces
      let commits = await gitService.getCommitsFromWorkspaces(userPattern, startDate, endDate, !!includeUnnamed);

      if (limit) {
        const pg = Math.max(1, parseInt(page || 1, 10));
        const lm = Math.max(1, parseInt(limit, 10));
        const offset = (pg - 1) * lm;
        commits = commits.slice(offset, offset + lm);
      }
      return commits;
    },
    codeChanges: async (
      _p,
      { user, users, startDate, endDate, repositories, page, limit, includeUnnamed },
      { gitService }
    ) => {
      let userPattern = null;
      if (user) userPattern = user;
      else if (Array.isArray(users) && users.length) userPattern = users.join('|');

      // Always fetch across saved Work Spaces
      let changes = await gitService.getCodeChangesFromWorkspaces(userPattern, startDate, endDate, !!includeUnnamed);

      if (limit) {
        const pg = Math.max(1, parseInt(page || 1, 10));
        const lm = Math.max(1, parseInt(limit, 10));
        const offset = (pg - 1) * lm;
        changes = changes.slice(offset, offset + lm);
      }
      return changes;
    },
    commitDetails: async (_p, { repositoryId, hash }, { gitService }) => {
      return gitService.getCommitDetails(repositoryId, hash);
    },
    commitDetailsByPath: async (_p, { repoPath, hash }, { gitService }) => {
      return gitService.getCommitDetailsByPath(repoPath, hash);
    },
    fileDiff: async (_p, { repositoryId, hash, filePath }, { gitService }) => {
      return gitService.getFileDiff(repositoryId, hash, filePath);
    },
    fileDiffByPath: async (_p, { repoPath, hash, filePath }, { gitService }) => {
      return gitService.getFileDiffByPath(repoPath, hash, filePath);
    },
    gitUsers: async (_p, _a, { gitService }) => {
      return gitService.getAllGitUsers();
    },
    branches: async (_p, { repositoryId }, { gitService }) => {
      const branches = await gitService.getBranches(repositoryId);
      return { current: branches.current, detached: !!branches.detached, all: branches.all || [] };
    },
    workspaces: async (_p, _a, { gitService }) => {
      return gitService.getWorkspaces();
    },
    workspacesRepositories: async (_p, { workspaces, maxDepth, exclude, followSymlinks }, { gitService }) => {
      const options = {};
      if (typeof maxDepth !== 'undefined' && maxDepth !== null) options.maxDepth = parseInt(maxDepth, 10);
      if (Array.isArray(exclude)) options.exclude = exclude;
      if (typeof followSymlinks !== 'undefined') options.followSymlinks = !!followSymlinks;
      return gitService.getRepositoriesFromWorkspaces(workspaces || null, options);
    },
    projectChanges: async (_p, { repositoryId, startDate, endDate, page, limit }, { gitService }) => {
      let changes = await gitService.getProjectChanges(repositoryId, startDate, endDate);
      if (limit) {
        const pg = Math.max(1, parseInt(page || 1, 10));
        const lm = Math.max(1, parseInt(limit, 10));
        const offset = (pg - 1) * lm;
        changes = changes.slice(offset, offset + lm);
      }
      return changes;
    },
  },
};

// Setup function to mount GraphQL on Express app
async function setupGraphQL(app) {
  // Initialize a dedicated GitService for GraphQL
  const gitService = new GitService();
  await gitService.initialize();

  const schema = makeExecutableSchema({ typeDefs, resolvers });
  const server = new ApolloServer({ schema });
  await server.start();

  // Mount at /api/graphql with existing auth
  app.use('/api/graphql', authenticate, expressMiddleware(server, {
    context: async ({ req }) => ({ user: req.user, apiToken: req.apiToken, gitService })
  }));

  return server;
}

module.exports = { setupGraphQL };
