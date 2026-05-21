const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const GitService = require('../models/GitService');
const ContributorService = require('../services/ContributorService');
const SettingsService = require('../services/SettingsService');
const GitLabClient = require('../services/GitLabClient');
const { authenticateToken, authenticateApiToken } = require('../middleware/auth');
const { parseUserFilter } = require('../lib/userFilter');

const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey) return authenticateApiToken(req, res, next);
  return authenticateToken(req, res, next);
};

const typeDefs = /* GraphQL */ `
  type Repository {
    id: ID!
    name: String!
    path: String!
    url: String
    description: String
    display_name: String
    folder_name: String
  }

  type Commit {
    repository: String!
    repositoryId: Int
    repositoryPath: String
    hash: String!
    author: String
    authorEmail: String
    contributorId: Int
    contributorName: String
    date: String
    message: String
    body: String
    branch: String
    files: [FileStat!]
    changes: String
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

  type Pagination {
    page: Int!
    limit: Int!
    total: Int!
    totalPages: Int!
  }

  type CommitsResult {
    commits: [Commit!]!
    pagination: Pagination!
  }

  type CodeChangesResult {
    changes: [CodeChange!]!
    pagination: Pagination!
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

  type Contributor {
    id: ID!
    display_name: String!
    primary_email: String
    gitlab_user_id: Int
    alias_count: Int
  }

  type ContributorAlias {
    author_name: String
    author_email: String
    commit_count: Int
  }

  type ContributorStats {
    name: String!
    contributor_id: Int
    commit_count: Int!
  }

  type RepositoryStats {
    name: String!
    repository_id: Int!
    commit_count: Int!
  }

  type TimeBucket {
    bucket: String!
    count: Int!
  }

  type LinesBucket {
    bucket: String!
    additions: Int!
    deletions: Int!
  }

  type AnalyticsSummary {
    recentCommits: [Commit!]!
    topContributors: [ContributorStats!]!
    topRepositories: [RepositoryStats!]!
    commitsOverTime: [TimeBucket!]!
    linesOverTime: [LinesBucket!]!
    filesChanged: Int!
    totalAdditions: Int!
    totalDeletions: Int!
  }

  type AppSettings {
    index_window_months: String
    retention_idle_days: String
    workspace_scan_interval_minutes: String
  }

  type GitLabIntegration {
    base_url: String
    enabled: Boolean
    last_sync_at: String
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
      branch: String,
      page: Int,
      limit: Int,
      includeUnnamed: Boolean,
      includeChanges: Boolean,
      noCache: Boolean,
      hash: String,
      contributorId: Int,
      message: String
    ): CommitsResult!
    codeChanges(
      user: String,
      users: [String!],
      startDate: String,
      endDate: String,
      repositories: [Int!],
      page: Int,
      limit: Int,
      includeUnnamed: Boolean,
      hash: String,
      contributorId: Int,
      message: String
    ): CodeChangesResult!
    analytics(
      startDate: String,
      endDate: String,
      repositories: [Int!],
      contributorIds: [Int!]
    ): AnalyticsSummary!
    contributors: [Contributor!]!
    contributor(id: Int!): Contributor
    unmappedAliases(limit: Int): [ContributorAlias!]!
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
    ): CodeChangesResult!
    appSettings: AppSettings!
    gitlabIntegration: GitLabIntegration
  }

  type Mutation {
    updateSettings(
      index_window_months: String,
      retention_idle_days: String,
      workspace_scan_interval_minutes: String
    ): AppSettings!
    saveGitLabIntegration(baseUrl: String!, privateToken: String, enabled: Boolean): GitLabIntegration!
    syncGitLabUsers: String!
    linkAlias(contributorId: Int!, authorName: String, authorEmail: String): Boolean!
    mergeContributors(targetId: Int!, sourceIds: [Int!]!): Contributor!
  }
`;

const resolvers = {
  Query: {
    repositories: async (_p, _a, { gitService }) => gitService.getRepositories(),
    repositoryStats: async (_p, { id }, { gitService }) => gitService.getRepositoryStats(id),
    commits: async (_p, args, { gitService }) => {
      const t0 = Date.now();
      if (!gitService.analytics) {
        await gitService.initialize();
        if (process.env.COMMITS_QUERY_TIMING !== 'false' && process.env.COMMITS_QUERY_TIMING !== '0') {
          console.log(`[commits-query] graphql.initialize ${Date.now() - t0}ms`);
        }
      }
      const { identifiers, gitAuthorPattern } = parseUserFilter({ user: args.user, users: args.users });
      const result = await gitService.analytics.queryCommits({
        userIdentifiers: identifiers,
        gitAuthorPattern,
        contributorId: args.contributorId,
        hash: args.hash,
        message: args.message,
        startDate: args.startDate,
        endDate: args.endDate,
        repositoryIds: args.repositories,
        branch: args.branch,
        includeUnnamed: !!args.includeUnnamed,
        includeChanges: !!args.includeChanges,
        noCache: !!args.noCache,
        page: args.page || 1,
        limit: args.limit || 50
      });
      if (process.env.COMMITS_QUERY_TIMING !== 'false' && process.env.COMMITS_QUERY_TIMING !== '0') {
        console.log(`[commits-query] graphql.commits total=${Date.now() - t0}ms`);
      }
      return result;
    },
    codeChanges: async (_p, args, { gitService }) => {
      if (!gitService.analytics) await gitService.initialize();
      const { identifiers, gitAuthorPattern } = parseUserFilter({ user: args.user, users: args.users });
      return gitService.analytics.queryCodeChanges({
        userIdentifiers: identifiers,
        gitAuthorPattern,
        contributorId: args.contributorId,
        hash: args.hash,
        message: args.message,
        startDate: args.startDate,
        endDate: args.endDate,
        repositoryIds: args.repositories,
        includeUnnamed: !!args.includeUnnamed,
        page: args.page || 1,
        limit: args.limit || 50,
        includeChanges: true
      });
    },
    analytics: async (_p, args, { gitService }) => {
      if (!gitService.analytics) await gitService.initialize();
      return gitService.analytics.getAnalyticsSummary(
        args.startDate,
        args.endDate,
        args.repositories,
        args.contributorIds
      );
    },
    contributors: async (_p, _a, { gitService }) => {
      const svc = new ContributorService(gitService.db);
      return svc.listContributors();
    },
    contributor: async (_p, { id }, { gitService }) => {
      const svc = new ContributorService(gitService.db);
      return svc.getContributor(id);
    },
    unmappedAliases: async (_p, { limit }, { gitService }) => {
      const svc = new ContributorService(gitService.db);
      return svc.listUnmappedAliases(limit || 100);
    },
    commitDetails: async (_p, { repositoryId, hash }, { gitService }) =>
      gitService.getCommitDetails(repositoryId, hash),
    commitDetailsByPath: async (_p, { repoPath, hash }, { gitService }) =>
      gitService.getCommitDetailsByPath(repoPath, hash),
    fileDiff: async (_p, { repositoryId, hash, filePath }, { gitService }) =>
      gitService.getFileDiff(repositoryId, hash, filePath),
    fileDiffByPath: async (_p, { repoPath, hash, filePath }, { gitService }) =>
      gitService.getFileDiffByPath(repoPath, hash, filePath),
    gitUsers: async (_p, _a, { gitService }) => gitService.getAllGitUsers(),
    branches: async (_p, { repositoryId }, { gitService }) => {
      const branches = await gitService.getBranches(repositoryId);
      return { current: branches.current, detached: !!branches.detached, all: branches.all || [] };
    },
    workspaces: async (_p, _a, { gitService }) => gitService.getWorkspaces(),
    workspacesRepositories: async (_p, args, { gitService }) => {
      const options = {};
      if (args.maxDepth != null) options.maxDepth = parseInt(args.maxDepth, 10);
      if (Array.isArray(args.exclude)) options.exclude = args.exclude;
      if (args.followSymlinks != null) options.followSymlinks = !!args.followSymlinks;
      return gitService.getRepositoriesFromWorkspaces(args.workspaces || null, options);
    },
    projectChanges: async (_p, args, { gitService }) => {
      if (!gitService.analytics) await gitService.initialize();
      return gitService.analytics.queryCodeChanges({
        repositoryIds: [args.repositoryId],
        startDate: args.startDate,
        endDate: args.endDate,
        page: args.page || 1,
        limit: args.limit || 50,
        includeChanges: true,
        includeUnnamed: true
      });
    },
    appSettings: async (_p, _a, { gitService }) => {
      const settings = new SettingsService(gitService.db);
      return settings.getAll();
    },
    gitlabIntegration: async (_p, _a, { gitService }) => {
      const client = new GitLabClient(gitService.db);
      const row = await client.getIntegration();
      if (!row) return null;
      return {
        base_url: row.base_url,
        enabled: !!row.enabled,
        last_sync_at: row.last_sync_at
      };
    }
  },
  Mutation: {
    updateSettings: async (_p, args, { gitService, user }) => {
      if (user.role !== 'admin') throw new Error('Admin only');
      const settings = new SettingsService(gitService.db);
      return settings.setMany(args);
    },
    saveGitLabIntegration: async (_p, args, { gitService, user }) => {
      if (user.role !== 'admin') throw new Error('Admin only');
      const client = new GitLabClient(gitService.db);
      await client.saveIntegration({
        baseUrl: args.baseUrl,
        privateToken: args.privateToken,
        enabled: args.enabled
      });
      const row = await client.getIntegration();
      return {
        base_url: row.base_url,
        enabled: !!row.enabled,
        last_sync_at: row.last_sync_at
      };
    },
    syncGitLabUsers: async (_p, _a, { gitService, user }) => {
      if (user.role !== 'admin') throw new Error('Admin only');
      const client = new GitLabClient(gitService.db);
      const result = await client.syncUsers();
      return `Synced ${result.synced} users`;
    },
    linkAlias: async (_p, { contributorId, authorName, authorEmail }, { gitService, user }) => {
      if (user.role !== 'admin') throw new Error('Admin only');
      const svc = new ContributorService(gitService.db);
      await svc.linkAlias(contributorId, authorName, authorEmail);
      return true;
    },
    mergeContributors: async (_p, { targetId, sourceIds }, { gitService, user }) => {
      if (user.role !== 'admin') throw new Error('Admin only');
      const svc = new ContributorService(gitService.db);
      return svc.mergeContributors(targetId, sourceIds);
    }
  }
};

async function setupGraphQL(app, sharedGitService = null) {
  const gitService = sharedGitService || new GitService();
  if (!gitService.analytics) await gitService.initialize();

  const schema = makeExecutableSchema({ typeDefs, resolvers });
  const server = new ApolloServer({ schema });
  await server.start();

  app.use('/api/graphql', authenticate, expressMiddleware(server, {
    context: async ({ req }) => ({
      user: req.user,
      apiToken: req.apiToken,
      gitService
    })
  }));

  return server;
}

module.exports = { setupGraphQL };
