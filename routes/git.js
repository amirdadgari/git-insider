const express = require('express');
const router = express.Router();
const path = require('path');
const GitService = require('../models/GitService');
const { authenticateToken, authenticateApiToken } = require('../middleware/auth');

const gitService = new GitService();

// Initialize git service
gitService.initialize().catch(console.error);

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

// Get commits by user(s) in date range
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
            page = 1,
            limit = 50
        } = req.query;

        // Handle single user or multiple users
        let userPattern = null;
        if (user) {
            userPattern = user;
        } else if (users) {
            // For multiple users, we'll need to make separate calls and combine
            const userList = users.split(',').map(u => u.trim());
            userPattern = userList.join('|');
        }

        // Always search across all repositories found under saved workspaces
        const includeUnnamedBool = String(includeUnnamed).toLowerCase() === 'true';
        const noCacheBool = String(noCache).toLowerCase() === 'true';
        const pgNum = Math.max(1, parseInt(page, 10) || 1);
        const lmNum = Math.max(1, parseInt(limit, 10) || 50);
        const earlyLimit = pgNum * lmNum;
        let commits = await gitService.getCommitsFromWorkspaces(
            userPattern,
            startDate,
            endDate,
            includeUnnamedBool,
            { limit: earlyLimit, noCache: noCacheBool }
        );

        // Simple pagination
        const offset = (page - 1) * limit;
        const paginatedCommits = commits.slice(offset, offset + parseInt(limit));

        res.json({
            commits: paginatedCommits,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: commits.length,
                totalPages: Math.ceil(commits.length / limit)
            }
        });
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
            page = 1,
            limit = 50
        } = req.query;

        let userPattern = null;
        if (user) {
            userPattern = user;
        } else if (users) {
            const userList = users.split(',').map(u => u.trim());
            userPattern = userList.join('|');
        }

        // Always search across all repositories found under saved workspaces
        const includeUnnamedBool = String(includeUnnamed).toLowerCase() === 'true';
        const pgNum = Math.max(1, parseInt(page, 10) || 1);
        const lmNum = Math.max(1, parseInt(limit, 10) || 50);
        const earlyLimit = pgNum * lmNum;
        let changes = await gitService.getCodeChangesFromWorkspaces(
            userPattern,
            startDate,
            endDate,
            includeUnnamedBool,
            { limit: earlyLimit }
        );

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
        const { query, repositories, startDate, endDate, page = 1, limit = 50 } = req.query;

        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const repositoryIds = repositories ? repositories.split(',').map(id => parseInt(id.trim())) : null;
        const pgNum = Math.max(1, parseInt(page, 10) || 1);
        const lmNum = Math.max(1, parseInt(limit, 10) || 50);
        const earlyLimit = pgNum * lmNum;

        const results = await gitService.searchCommits({
            query,
            userPattern: null,
            startDate,
            endDate,
            repositoryIds,
            options: { limit: earlyLimit }
        });

        // Simple pagination
        const offset = (pgNum - 1) * lmNum;
        const paginatedCommits = results.slice(offset, offset + lmNum);

        res.json({
            commits: paginatedCommits,
            pagination: {
                page: pgNum,
                limit: lmNum,
                total: results.length,
                totalPages: Math.ceil(results.length / lmNum)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
