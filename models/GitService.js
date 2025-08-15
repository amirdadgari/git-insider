const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');
const moment = require('moment');
const Database = require('../config/database');

class GitService {
    constructor() {
        this.db = new Database();
        this.repositories = new Map();
    }

    async initialize() {
        await this.db.connect();
        await this.loadRepositories();
    }

    async loadRepositories() {
        try {
            const repos = await this.db.all('SELECT * FROM git_repositories WHERE is_active = 1');
            
            for (const repo of repos) {
                try {
                    await fs.access(repo.path);
                    const git = simpleGit(repo.path);
                    await git.status(); // Verify it's a valid git repository
                    this.repositories.set(repo.id, {
                        ...repo,
                        git: git
                    });
                    console.log(`Loaded repository: ${repo.name}`);
                } catch (error) {
                    console.warn(`Warning: Repository ${repo.name} at ${repo.path} is not accessible`);
                }
            }
        } catch (error) {
            console.error('Error loading repositories:', error);
        }
    }

    // Get commit details by repository path (for workspace-scanned repos)
    async getCommitDetailsByPath(repoPath, commitHash) {
        if (!repoPath) throw new Error('Repository path is required');
        try {
            const git = simpleGit(repoPath);
            await git.status();

            const show = await git.show([commitHash, '--name-status']);
            const commit = await git.show([commitHash, '--format=fuller']);

            return {
                repository: path.basename(repoPath),
                hash: commitHash,
                details: commit,
                changedFiles: show
            };
        } catch (error) {
            throw new Error(`Error getting commit details by path: ${error.message}`);
        }
    }

    // Workspaces
    async getWorkspaces() {
        const workspaces = await this.db.all('SELECT * FROM workspaces WHERE is_active = 1 ORDER BY created_at DESC');
        return workspaces;
    }

    async scanWorkspace(rootPath, options = {}) {
        if (!rootPath || typeof rootPath !== 'string') {
            throw new Error('A valid root path is required');
        }

        const normalizedRoot = path.resolve(rootPath);
        // Reuse existing scanning logic
        const repositories = await this.scanForRepositories(normalizedRoot, options);
        const repoCount = repositories.length;

        // Upsert workspace row
        const name = path.basename(normalizedRoot);
        const existing = await this.db.get('SELECT * FROM workspaces WHERE root_path = ?', [normalizedRoot]);
        if (existing) {
            await this.db.run(
                'UPDATE workspaces SET repo_count = ?, last_scanned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, name = COALESCE(name, ?) WHERE id = ?',
                [repoCount, name, existing.id]
            );
            const workspace = await this.db.get('SELECT * FROM workspaces WHERE id = ?', [existing.id]);
            return { root: normalizedRoot, count: repoCount, repositories, workspace };
        } else {
            const result = await this.db.run(
                'INSERT INTO workspaces (root_path, name, repo_count, last_scanned_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
                [normalizedRoot, name, repoCount]
            );
            const workspace = await this.db.get('SELECT * FROM workspaces WHERE id = ?', [result.id]);
            return { root: normalizedRoot, count: repoCount, repositories, workspace };
        }
    }

    async deleteWorkspace(id) {
        if (!id) throw new Error('Workspace id is required');
        const result = await this.db.run('DELETE FROM workspaces WHERE id = ?', [id]);
        return { deleted: result.changes > 0 };
    }

    async addRepository(name, repoPath, url = null, description = null) {
        try {
            // Verify the path contains a git repository
            const git = simpleGit(repoPath);
            await git.status();

            const result = await this.db.run(
                'INSERT INTO git_repositories (name, path, url, description) VALUES (?, ?, ?, ?)',
                [name, repoPath, url, description]
            );

            const newRepo = {
                id: result.id,
                name,
                path: repoPath,
                url,
                description,
                git: git
            };

            this.repositories.set(result.id, newRepo);
            return newRepo;
        } catch (error) {
            throw new Error(`Invalid git repository: ${error.message}`);
        }
    }

    async getRepositories() {
        const repos = await this.db.all('SELECT * FROM git_repositories WHERE is_active = 1 ORDER BY name');
        return repos;
    }

    async getCommitsByUser(userPattern, startDate, endDate, repositoryIds = null) {
        const commits = [];
        const repoFilter = repositoryIds ? new Set(repositoryIds) : null;
        const startBound = startDate ? moment(startDate, 'YYYY-MM-DD').startOf('day').toDate() : null;
        const endBound = endDate ? moment(endDate, 'YYYY-MM-DD').endOf('day').toDate() : null;

        for (const [repoId, repo] of this.repositories) {
            if (repoFilter && !repoFilter.has(repoId)) continue;

            try {
                const format = {
                    hash: '%H',
                    author: '%an',
                    authorEmail: '%ae',
                    date: '%ai',
                    message: '%s',
                    body: '%b'
                };

                const customArgs = [];
                if (userPattern) customArgs.push(`--author=${userPattern}`);
                if (startDate) customArgs.push(`--since=${startDate}`);
                if (endDate) customArgs.push(`--until=${endDate}`);

                const log = await repo.git.log({ format }, customArgs);
                
                for (const commit of log.all) {
                    const cDate = new Date(commit.date);
                    if (startBound && cDate < startBound) continue;
                    if (endBound && cDate > endBound) continue;
                    commits.push({
                        repository: repo.name,
                        repositoryId: repoId,
                        hash: commit.hash,
                        author: commit.author || commit.author_name,
                        authorEmail: commit.authorEmail || commit.author_email,
                        date: commit.date,
                        message: commit.message,
                        body: commit.body
                    });
                }
            } catch (error) {
                console.error(`Error getting commits from ${repo.name}:`, error.message);
            }
        }

        return commits.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    // Get commits across all repositories found under saved workspaces
    async getCommitsFromWorkspaces(userPattern, startDate, endDate) {
        const commits = [];
        const startBound = startDate ? moment(startDate, 'YYYY-MM-DD').startOf('day').toDate() : null;
        const endBound = endDate ? moment(endDate, 'YYYY-MM-DD').endOf('day').toDate() : null;
        try {
            const workspaces = await this.getWorkspaces();
            for (const ws of workspaces) {
                try {
                    const repos = await this.scanForRepositories(ws.root_path, {});
                    for (const repoInfo of repos) {
                        try {
                            const git = simpleGit(repoInfo.path);
                            await git.status();

                            const format = {
                                hash: '%H',
                                author: '%an',
                                authorEmail: '%ae',
                                date: '%ai',
                                message: '%s',
                                body: '%b'
                            };

                            const customArgs = [];
                            if (userPattern) customArgs.push(`--author=${userPattern}`);
                            if (startDate) customArgs.push(`--since=${startDate}`);
                            if (endDate) customArgs.push(`--until=${endDate}`);

                            const log = await git.log({ format }, customArgs);
                            for (const commit of log.all) {
                                const cDate = new Date(commit.date);
                                if (startBound && cDate < startBound) continue;
                                if (endBound && cDate > endBound) continue;
                                commits.push({
                                    repository: repoInfo.name,
                                    repositoryId: null,
                                    repositoryPath: repoInfo.path,
                                    hash: commit.hash,
                                    author: commit.author || commit.author_name,
                                    authorEmail: commit.authorEmail || commit.author_email,
                                    date: commit.date,
                                    message: commit.message,
                                    body: commit.body
                                });
                            }
                        } catch (innerErr) {
                            console.error(`Error getting commits from ${repoInfo.path}:`, innerErr.message);
                        }
                    }
                } catch (scanErr) {
                    console.error(`Error scanning workspace ${ws.root_path}:`, scanErr.message);
                }
            }
        } catch (error) {
            console.error('Error getting commits from workspaces:', error.message);
        }

        return commits.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    async getCommitDetails(repositoryId, commitHash) {
        const repo = this.repositories.get(repositoryId);
        if (!repo) throw new Error('Repository not found');

        try {
            const show = await repo.git.show([commitHash, '--name-status']);
            const commit = await repo.git.show([commitHash, '--format=fuller']);
            
            return {
                repository: repo.name,
                hash: commitHash,
                details: commit,
                changedFiles: show
            };
        } catch (error) {
            throw new Error(`Error getting commit details: ${error.message}`);
        }
    }

    async getCodeChangesByUser(userPattern, startDate, endDate, repositoryIds = null) {
        const changes = [];
        const repoFilter = repositoryIds ? new Set(repositoryIds) : null;
        const startBound = startDate ? moment(startDate, 'YYYY-MM-DD').startOf('day').toDate() : null;
        const endBound = endDate ? moment(endDate, 'YYYY-MM-DD').endOf('day').toDate() : null;

        for (const [repoId, repo] of this.repositories) {
            if (repoFilter && !repoFilter.has(repoId)) continue;

            try {
                const options = [
                    '--numstat',
                    '--pretty=format:%H|%an|%ae|%ai|%s'
                ];

                if (userPattern) options.push(`--author=${userPattern}`);
                if (startDate) options.push(`--since=${startDate}`);
                if (endDate) options.push(`--until=${endDate}`);

                const log = await repo.git.raw(['log', ...options]);
                const lines = log.split('\n');
                
                let currentCommit = null;
                
                for (const line of lines) {
                    if (line.includes('|') && !line.match(/^\d+\s+\d+\s+/)) {
                        const [hash, author, email, date, message] = line.split('|');
                        currentCommit = {
                            repository: repo.name,
                            repositoryId: repoId,
                            hash,
                            author,
                            email,
                            date,
                            message,
                            files: []
                        };
                        const cDate = new Date(date);
                        if ((startBound && cDate < startBound) || (endBound && cDate > endBound)) {
                            currentCommit = null; // skip this commit entirely
                        } else {
                            changes.push(currentCommit);
                        }
                    } else if (line.match(/^\d+\s+\d+\s+/) && currentCommit) {
                        const [additions, deletions, filename] = line.split('\t');
                        currentCommit.files.push({
                            filename,
                            additions: parseInt(additions) || 0,
                            deletions: parseInt(deletions) || 0
                        });
                    }
                }
            } catch (error) {
                console.error(`Error getting code changes from ${repo.name}:`, error.message);
            }
        }

        return changes.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    // Get diff for a single file in a commit by repository ID
    async getFileDiff(repositoryId, commitHash, filePath) {
        const repo = this.repositories.get(repositoryId);
        if (!repo) throw new Error('Repository not found');

        if (!filePath) throw new Error('File path is required');
        try {
            // Show the patch affecting the specific file for this commit
            const diff = await repo.git.show([commitHash, '--', filePath]);
            return diff;
        } catch (error) {
            throw new Error(`Error getting file diff: ${error.message}`);
        }
    }

    // Get diff for a single file in a commit by repository path (workspace-scanned)
    async getFileDiffByPath(repoPath, commitHash, filePath) {
        if (!repoPath) throw new Error('Repository path is required');
        if (!filePath) throw new Error('File path is required');
        try {
            const git = simpleGit(repoPath);
            await git.status();
            const diff = await git.show([commitHash, '--', filePath]);
            return diff;
        } catch (error) {
            throw new Error(`Error getting file diff by path: ${error.message}`);
        }
    }

    // Get code changes across repositories found under saved workspaces
    async getCodeChangesFromWorkspaces(userPattern, startDate, endDate) {
        const changes = [];
        const startBound = startDate ? moment(startDate, 'YYYY-MM-DD').startOf('day').toDate() : null;
        const endBound = endDate ? moment(endDate, 'YYYY-MM-DD').endOf('day').toDate() : null;

        try {
            const workspaces = await this.getWorkspaces();
            for (const ws of workspaces) {
                try {
                    const repos = await this.scanForRepositories(ws.root_path, {});
                    for (const repoInfo of repos) {
                        try {
                            const git = simpleGit(repoInfo.path);
                            await git.status();

                            const options = [
                                '--numstat',
                                '--pretty=format:%H|%an|%ae|%ai|%s'
                            ];

                            if (userPattern) options.push(`--author=${userPattern}`);
                            if (startDate) options.push(`--since=${startDate}`);
                            if (endDate) options.push(`--until=${endDate}`);

                            const log = await git.raw(['log', ...options]);
                            const lines = log.split('\n');

                            let currentCommit = null;
                            for (const line of lines) {
                                if (line.includes('|') && !line.match(/^\d+\s+\d+\s+/)) {
                                    const [hash, author, email, date, message] = line.split('|');
                                    currentCommit = {
                                        repository: repoInfo.name,
                                        repositoryId: null,
                                        repositoryPath: repoInfo.path,
                                        hash,
                                        author,
                                        email,
                                        date,
                                        message,
                                        files: []
                                    };
                                    const cDate = new Date(date);
                                    if ((startBound && cDate < startBound) || (endBound && cDate > endBound)) {
                                        currentCommit = null;
                                    } else {
                                        changes.push(currentCommit);
                                    }
                                } else if (line.match(/^\d+\s+\d+\s+/) && currentCommit) {
                                    const [additions, deletions, filename] = line.split('\t');
                                    currentCommit.files.push({
                                        filename,
                                        additions: parseInt(additions) || 0,
                                        deletions: parseInt(deletions) || 0
                                    });
                                }
                            }
                        } catch (innerErr) {
                            console.error(`Error getting code changes from ${repoInfo.path}:`, innerErr.message);
                        }
                    }
                } catch (scanErr) {
                    console.error(`Error scanning workspace ${ws.root_path}:`, scanErr.message);
                }
            }
        } catch (error) {
            console.error('Error getting code changes from workspaces:', error.message);
        }

        return changes.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    async getProjectChanges(repositoryId, startDate, endDate) {
        const repo = this.repositories.get(repositoryId);
        if (!repo) throw new Error('Repository not found');

        try {
            const options = [
                '--numstat',
                '--pretty=format:%H|%an|%ae|%ai|%s'
            ];

            if (startDate) options.push(`--since=${startDate}`);
            if (endDate) options.push(`--until=${endDate}`);

            const log = await repo.git.raw(['log', ...options]);
            const changes = this.parseLogOutput(log, repo.name, repositoryId);
            
            return changes.sort((a, b) => new Date(b.date) - new Date(a.date));
        } catch (error) {
            throw new Error(`Error getting project changes: ${error.message}`);
        }
    }

    parseLogOutput(logOutput, repoName, repoId) {
        const lines = logOutput.split('\n');
        const changes = [];
        let currentCommit = null;

        for (const line of lines) {
            if (line.includes('|') && !line.match(/^\d+\s+\d+\s+/)) {
                const [hash, author, email, date, message] = line.split('|');
                currentCommit = {
                    repository: repoName,
                    repositoryId: repoId,
                    hash,
                    author,
                    email,
                    date,
                    message,
                    files: []
                };
                changes.push(currentCommit);
            } else if (line.match(/^\d+\s+\d+\s+/) && currentCommit) {
                const [additions, deletions, filename] = line.split('\t');
                currentCommit.files.push({
                    filename,
                    additions: parseInt(additions) || 0,
                    deletions: parseInt(deletions) || 0
                });
            }
        }

        return changes;
    }

    async getAllGitUsers() {
        const users = new Set();

        for (const [repoId, repo] of this.repositories) {
            try {
                const log = await repo.git.log({
                    format: {
                        author: '%an',
                        email: '%ae'
                    }
                });

                for (const commit of log.all) {
                    users.add(JSON.stringify({
                        name: commit.author,
                        email: commit.author_email
                    }));
                }
            } catch (error) {
                console.error(`Error getting users from ${repo.name}:`, error.message);
            }
        }

        return Array.from(users).map(user => JSON.parse(user));
    }

    async getBranches(repositoryId) {
        const repo = this.repositories.get(repositoryId);
        if (!repo) throw new Error('Repository not found');

        try {
            const branches = await repo.git.branch(['-a']);
            return branches;
        } catch (error) {
            throw new Error(`Error getting branches: ${error.message}`);
        }
    }

    async getRepositoryStats(repositoryId) {
        const repo = this.repositories.get(repositoryId);
        if (!repo) throw new Error('Repository not found');

        try {
            const log = await repo.git.log();
            const contributors = new Set();
            
            for (const commit of log.all) {
                contributors.add(commit.author_email);
            }

            const branches = await repo.git.branch(['-a']);
            
            return {
                repository: repo.name,
                totalCommits: log.total,
                contributors: contributors.size,
                branches: branches.all.length,
                lastCommit: log.latest ? {
                    hash: log.latest.hash,
                    author: log.latest.author_name,
                    date: log.latest.date,
                    message: log.latest.message
                } : null
            };
        } catch (error) {
            throw new Error(`Error getting repository stats: ${error.message}`);
        }
    }

    // Recursively scan a folder for git repositories by checking for a .git directory
    async scanForRepositories(rootPath, options = {}) {
        const { maxDepth = 4, exclude = ['node_modules', '.git', '.hg', '.svn', 'dist', 'build', '.next'], followSymlinks = false } = options;

        if (!rootPath || typeof rootPath !== 'string') {
            throw new Error('A valid root path is required');
        }

        // Normalize and ensure absolute path
        const normalizedRoot = path.resolve(rootPath);

        // Load existing repository paths once for quick lookup
        const existing = await this.db.all('SELECT path FROM git_repositories');
        const existingPaths = new Set(existing.map(r => path.normalize(r.path)));

        const results = [];

        const isExcluded = (name) => exclude.some(ex => ex.toLowerCase() === name.toLowerCase());

        const hasGitFolder = async (dir) => {
            try {
                await fs.access(path.join(dir, '.git'));
                return true;
            } catch {
                return false;
            }
        };

        const walk = async (dir, depth) => {
            if (depth < 0) return;
            try {
                // If this directory itself is a git repo, record and do not descend further
                if (await hasGitFolder(dir)) {
                    results.push({
                        name: path.basename(dir),
                        path: dir,
                        alreadyAdded: existingPaths.has(path.normalize(dir))
                    });
                    return; // don't scan nested repos inside
                }

                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    if (isExcluded(entry.name)) continue;

                    const child = path.join(dir, entry.name);
                    try {
                        const stat = followSymlinks ? await fs.stat(child) : await fs.lstat(child);
                        if (!stat.isDirectory()) continue;
                        // Avoid recursing into symlinked dirs unless allowed
                        if (!followSymlinks && stat.isSymbolicLink && stat.isSymbolicLink()) continue;
                    } catch {
                        continue; // skip unreadable entries
                    }

                    await walk(child, depth - 1);
                }
            } catch (err) {
                // Ignore directories we cannot read
                return;
            }
        };

        await walk(normalizedRoot, maxDepth);

        // Sort for stable output
        results.sort((a, b) => a.name.localeCompare(b.name));
        return results;
    }

    // Aggregate repositories found under saved workspaces
    async getRepositoriesFromWorkspaces(workspaceIds = null, options = {}) {
        const results = [];
        try {
            let workspaces = await this.getWorkspaces();
            if (Array.isArray(workspaceIds) && workspaceIds.length > 0) {
                const idSet = new Set(workspaceIds.map(id => parseInt(id, 10)));
                workspaces = workspaces.filter(ws => idSet.has(ws.id));
            }

            for (const ws of workspaces) {
                try {
                    const repos = await this.scanForRepositories(ws.root_path, options);
                    for (const r of repos) {
                        results.push({
                            ...r,
                            workspaceId: ws.id,
                            workspaceName: ws.name || (ws.root_path.split(/\\|\//).pop()),
                            workspaceRoot: ws.root_path
                        });
                    }
                } catch (err) {
                    console.error(`Error scanning workspace ${ws.root_path}:`, err.message);
                }
            }
        } catch (error) {
            console.error('Error aggregating repositories from workspaces:', error.message);
        }

        // stable sort by workspace then repo name
        results.sort((a, b) => {
            const wa = String(a.workspaceName).localeCompare(String(b.workspaceName));
            if (wa !== 0) return wa;
            return String(a.name).localeCompare(String(b.name));
        });
        return results;
    }
}

module.exports = GitService;
