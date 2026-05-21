const express = require('express');
const router = express.Router();
const path = require('path');
const GitService = require('../models/GitService');
const { authenticateToken, authenticateApiToken } = require('../middleware/auth');

const gitService = new GitService();
const ContributorService = require('../services/ContributorService');
const { parseUserFilter } = require('../lib/userFilter');

gitService.initialize().catch(console.error);

async function ensureAnalytics() {
    if (!gitService.analytics) await gitService.initialize();
    return gitService.analytics;
}

function parseRepositoryIds(repositories) {
    if (!repositories) return null;
    return repositories.split(',').map((id) => parseInt(id.trim(), 10)).filter((n) => !Number.isNaN(n));
}

// Authentication middleware for both web and API access
const authenticate = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
        return authenticateApiToken(req, res, next);
    } else {
        return authenticateToken(req, res, next);
    }
};

// Get all repositories
router.get('/repositories', authenticate, async (req, res) => {
    try {
        const repositories = await gitService.getRepositories();
        res.json(repositories);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rename repository display label (custom override)
router.patch('/repositories/:id/display-name', authenticate, async (req, res) => {
    try {
        const repositoryId = parseInt(req.params.id, 10);
        const { displayName, reset } = req.body || {};
        const updated = await gitService.updateRepositoryDisplayName(repositoryId, displayName, { reset: !!reset });
        res.json(updated);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get per-file diff for a commit by repository ID
router.get('/diff/:repositoryId/:hash', authenticate, async (req, res) => {
    try {
        const repositoryId = parseInt(req.params.repositoryId);
        const commitHash = req.params.hash;
        const { filePath } = req.query;
        if (!filePath) {
            return res.status(400).json({ error: 'filePath is required' });
        }

        const diff = await gitService.getFileDiff(repositoryId, commitHash, filePath);
        res.type('text/plain').send(diff);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get per-file diff for a commit by repository path (workspace-scanned)
router.get('/diff/by-path', authenticate, async (req, res) => {
    try {
        const { repoPath, hash, filePath } = req.query;
        if (!repoPath || !hash || !filePath) {
            return res.status(400).json({ error: 'repoPath, hash and filePath are required' });
        }

        const diff = await gitService.getFileDiffByPath(repoPath, hash, filePath);
        res.type('text/plain').send(diff);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Workspaces: list saved root folders
router.get('/workspaces', authenticate, async (req, res) => {
    try {
        const workspaces = await gitService.getWorkspaces();
        res.json(workspaces);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Aggregate repositories from saved workspaces
router.get('/workspaces/repositories', authenticate, async (req, res) => {
    try {
        const { workspaces, maxDepth, exclude, followSymlinks } = req.query;
        const workspaceIds = workspaces ? workspaces.split(',').map(id => parseInt(id.trim())) : null;
        const options = {};
        if (typeof maxDepth !== 'undefined' && maxDepth !== '') options.maxDepth = parseInt(maxDepth, 10);
        if (typeof exclude === 'string' && exclude.trim() !== '') options.exclude = exclude.split(',').map(s => s.trim()).filter(Boolean);
        if (typeof followSymlinks !== 'undefined') options.followSymlinks = String(followSymlinks).toLowerCase() === 'true';

        const repositories = await gitService.getRepositoriesFromWorkspaces(workspaceIds, options);
        res.json({ count: repositories.length, repositories });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Scan a folder recursively for git repositories
router.post('/repositories/scan', authenticate, async (req, res) => {
    try {
        const { path: rootPath, maxDepth, exclude, followSymlinks } = req.body || {};
        if (!rootPath) {
            return res.status(400).json({ error: 'Root path is required' });
        }

        const repositories = await gitService.scanForRepositories(rootPath, {
            maxDepth: typeof maxDepth === 'number' ? maxDepth : undefined,
            exclude: Array.isArray(exclude) ? exclude : undefined,
            followSymlinks: !!followSymlinks
        });

        res.json({
            root: path.resolve(rootPath),
            count: repositories.length,
            repositories
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Scan a workspace (root folder), persist count and return repositories
router.post('/workspaces/scan', authenticate, async (req, res) => {
    try {
        const { path: rootPath, maxDepth, exclude, followSymlinks } = req.body || {};
        if (!rootPath) {
            return res.status(400).json({ error: 'Root path is required' });
        }

        const result = await gitService.scanWorkspace(rootPath, {
            maxDepth: typeof maxDepth === 'number' ? maxDepth : undefined,
            exclude: Array.isArray(exclude) ? exclude : undefined,
            followSymlinks: !!followSymlinks
        });

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get repository statistics
router.get('/repositories/:id/stats', authenticate, async (req, res) => {
    try {
        const repositoryId = parseInt(req.params.id);
        const stats = await gitService.getRepositoryStats(repositoryId);
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get commits by user(s) in date range (indexed DB with optional live fallback)
router.get('/commits', authenticate, async (req, res) => {
    try {
        const {
            user,
            users,
            startDate,
            endDate,
            repositories,
            includeUnnamed,
            noCache,
            branch,
            includeChanges,
            hash,
            contributorId,
            message,
            page = 1,
            limit = 50
        } = req.query;

        const analytics = await ensureAnalytics();
        const { identifiers, gitAuthorPattern } = parseUserFilter({ user, users });
        const result = await analytics.queryCommits({
            userIdentifiers: identifiers,
            gitAuthorPattern,
            contributorId: contributorId ? parseInt(contributorId, 10) : null,
            hash,
            message,
            startDate,
            endDate,
            repositoryIds: parseRepositoryIds(repositories),
            branch,
            includeUnnamed: String(includeUnnamed).toLowerCase() === 'true',
            includeChanges: String(includeChanges).toLowerCase() === 'true',
            noCache: String(noCache).toLowerCase() === 'true',
            page: parseInt(page, 10) || 1,
            limit: parseInt(limit, 10) || 50
        });

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get commit details by repository path (for workspace-scanned commits)
router.get('/commits/by-path', authenticate, async (req, res) => {
    try {
        const { repoPath, hash } = req.query;
        if (!repoPath || !hash) {
            return res.status(400).json({ error: 'repoPath and hash are required' });
        }

        const details = await gitService.getCommitDetailsByPath(repoPath, hash);
        res.json(details);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get commit details
router.get('/commits/:repositoryId/:hash', authenticate, async (req, res) => {
    try {
        const repositoryId = parseInt(req.params.repositoryId);
        const commitHash = req.params.hash;
        
        const commitDetails = await gitService.getCommitDetails(repositoryId, commitHash);
        res.json(commitDetails);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get code changes by user(s) in date range
router.get('/code-changes', authenticate, async (req, res) => {
    try {
        const {
            user,
            users,
            startDate,
            endDate,
            repositories,
            includeUnnamed,
            contributorId,
            hash,
            message,
            page = 1,
            limit = 50
        } = req.query;

        const analytics = await ensureAnalytics();
        const { identifiers, gitAuthorPattern } = parseUserFilter({ user, users });
        const result = await analytics.queryCodeChanges({
            userIdentifiers: identifiers,
            gitAuthorPattern,
            contributorId: contributorId ? parseInt(contributorId, 10) : null,
            hash,
            message,
            startDate,
            endDate,
            repositoryIds: parseRepositoryIds(repositories),
            includeUnnamed: String(includeUnnamed).toLowerCase() === 'true',
            page: parseInt(page, 10) || 1,
            limit: parseInt(limit, 10) || 50,
            includeChanges: true
        });

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Analytics summary
router.get('/analytics', authenticate, async (req, res) => {
    try {
        const { startDate, endDate, repositories, contributorIds } = req.query;
        const analytics = await ensureAnalytics();
        const repoIds = parseRepositoryIds(repositories);
        const contribIds = contributorIds
            ? contributorIds.split(',').map((id) => parseInt(id.trim(), 10)).filter((n) => !Number.isNaN(n))
            : null;
        const summary = await analytics.getAnalyticsSummary(startDate, endDate, repoIds, contribIds);
        res.json(summary);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Contributors
router.get('/contributors', authenticate, async (req, res) => {
    try {
        const svc = new ContributorService(gitService.db);
        const contributors = await svc.listContributors();
        res.json(contributors);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/contributors/unmapped', authenticate, async (req, res) => {
    try {
        const svc = new ContributorService(gitService.db);
        const aliases = await svc.listUnmappedAliases(parseInt(req.query.limit, 10) || 100);
        res.json(aliases);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/contributors/suggestions', authenticate, async (req, res) => {
    try {
        const svc = new ContributorService(gitService.db);
        const suggestions = await svc.searchAuthorIdentities(
            req.query.q || '',
            parseInt(req.query.limit, 10) || 15
        );
        res.json(suggestions);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/contributors/:id', authenticate, async (req, res) => {
    try {
        const svc = new ContributorService(gitService.db);
        const contributor = await svc.getContributor(parseInt(req.params.id, 10));
        if (!contributor) {
            return res.status(404).json({ error: 'Contributor not found' });
        }
        res.json(contributor);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/contributors', authenticate, async (req, res) => {
    try {
        const svc = new ContributorService(gitService.db);
        const contributor = await svc.createContributor(req.body);
        res.status(201).json(contributor);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.put('/contributors/:id', authenticate, async (req, res) => {
    try {
        const svc = new ContributorService(gitService.db);
        const contributor = await svc.updateContributor(parseInt(req.params.id, 10), req.body);
        res.json(contributor);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/contributors/:id/aliases', authenticate, async (req, res) => {
    try {
        const { authorName, authorEmail } = req.body;
        const svc = new ContributorService(gitService.db);
        const result = await svc.linkAlias(parseInt(req.params.id, 10), authorName, authorEmail);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/contributors/merge', authenticate, async (req, res) => {
    try {
        const { targetId, sourceIds } = req.body;
        const svc = new ContributorService(gitService.db);
        const contributor = await svc.mergeContributors(targetId, sourceIds || []);
        res.json(contributor);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Indexing progress (poll while indexing)
router.get('/index/status', authenticate, async (req, res) => {
    try {
        if (!gitService.indexer) await gitService.initialize();
        res.json(gitService.indexer.getProgress());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Trigger manual index (background, newest-first)
router.post('/index', authenticate, async (req, res) => {
    try {
        if (!gitService.indexer) await gitService.initialize();
        const result = await gitService.indexer.indexAllActiveRepos();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get project changes in date range
router.get('/repositories/:id/changes', authenticate, async (req, res) => {
    try {
        const repositoryId = parseInt(req.params.id);
        const { startDate, endDate, page = 1, limit = 50 } = req.query;

        const changes = await gitService.getProjectChanges(repositoryId, startDate, endDate);

        // Simple pagination
        const offset = (page - 1) * limit;
        const paginatedChanges = changes.slice(offset, offset + parseInt(limit));

        res.json({
            changes: paginatedChanges,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: changes.length,
                totalPages: Math.ceil(changes.length / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all git users across all repositories
router.get('/users', authenticate, async (req, res) => {
    try {
        const gitUsers = await gitService.getAllGitUsers();
        const q = (req.query.q || '').toString().trim().toLowerCase();
        if (q) {
            const filtered = gitUsers.filter(u => {
                const name = (u.name || '').toString().toLowerCase();
                const email = (u.email || '').toString().toLowerCase();
                return name.includes(q) || email.includes(q);
            });
            return res.json(filtered);
        }
        res.json(gitUsers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get branches for a repository
router.get('/repositories/:id/branches', authenticate, async (req, res) => {
    try {
        const repositoryId = parseInt(req.params.id);
        const branches = await gitService.getBranches(repositoryId);
        res.json(branches);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Search commits by message
router.get('/search/commits', authenticate, async (req, res) => {
    try {
        const { query, repositories, startDate, endDate, branch, page = 1, limit = 50 } = req.query;

        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const repositoryIds = repositories ? repositories.split(',').map(id => parseInt(id.trim())) : null;
        const pgNum = Math.max(1, parseInt(page, 10) || 1);
        const lmNum = Math.max(1, parseInt(limit, 10) || 50);
        const earlyLimit = pgNum * lmNum;

        const analytics = await ensureAnalytics();
        const result = await analytics.queryCommits({
            message: query,
            startDate,
            endDate,
            repositoryIds,
            branch,
            page: pgNum,
            limit: lmNum
        });

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
